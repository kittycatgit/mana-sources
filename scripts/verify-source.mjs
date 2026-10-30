// @ts-check
"use strict";

/**
 * Contract test for a built Mana source.
 *
 * Loads `dist/sources/<Name>.mana` into a V8 context with host shims, then
 * exercises the methods the app actually calls and asserts the shape of what
 * comes back. A Cloudflare challenge reports SKIP rather than FAIL, so the
 * suite stays meaningful on protected sites.
 *
 *   node scripts/verify-source.mjs <Name> [--probe path] [--verbose]
 *   node scripts/verify-source.mjs --all
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  INTENT_NAMES,
  ManaStore,
  createHttpHost,
  decodeIntents,
  expectedIntents,
  hostRuntimeSource,
  webViewPageFor,
} from "./harness/runtime.mjs";
import { assisted, closeBrowser } from "./harness/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_SOURCES = path.join(ROOT, "dist", "sources");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

class Skip extends Error {}

/** SectionStyle is a numeric enum in the bundle; these are its names. */
const SECTION_STYLE = [
  "SimpleSingleRow",
  "SimpleDoubleRow",
  "SimpleTripleRow",
  "SimpleHero",
  "SimpleHeroPaged",
  "DetailedSingleRowPaged",
  "DetailedDoubleRowPaged",
  "DetailedTripleRowPaged",
  "DetailedVerticalList",
  "DetailedVerticalListGrouped",
  "Grid",
];

/** Styles that render as a carousel — one tile gets repeated across the width. */
const HERO_STYLES = new Set([3, 4]);
const MIN_HERO_ITEMS = 3;
const MAX_SECTION_ITEMS = 20;

const PANEL_MODE = { 0: "PAGED_MANGA", 1: "PAGED_COMIC", 2: "PAGED_VERTICAL", 3: "WEBTOON" };
const PUBLICATION_STATUS = { 1: "ONGOING", 2: "COMPLETED", 3: "CANCELLED", 4: "HIATUS" };
const CONTENT_RATING = { 0: "SAFE", 1: "SUGGESTIVE", 2: "MATURE", 3: "EXPLICIT" };

/** `RequestOrigin` in the runtime: which transport the app asks a source for. */
const ORIGIN = { Cover: 1, Page: 2 };

/**
 * Fetches a handful of URLs and reports the ones that do not come back as images.
 *
 * A source with `getCoverTransport` or `getPageTransport` is telling the app which client
 * to load its images through — most often one that sends a referer the CDN refuses to
 * serve without, sometimes one that mints a cookie first. Fetching bare would report 403
 * on a source that works perfectly in the app, so each URL goes through the same
 * `loadImage` the app calls, which dispatches to the transport and hands back the body.
 * A source with no transport for that kind of image is fetched bare, as the app does.
 */
async function checkImageUrls(urls, loaded) {
  const { target, host, loadImage } = loaded;
  const broken = [];
  // An image host that challenges the harness is not an image that does not serve: the
  // browser loads it and the app may too. Reported apart, as unproven rather than broken.
  const challenged = [];
  for (const { url, origin } of urls) {
    const method = origin === ORIGIN.Page ? "getPageTransport" : "getCoverTransport";
    try {
      if (typeof target[method] === "function") {
        const native = await loadImage({ url, origin });
        const type = String(native.headers?.["content-type"] ?? "");
        const length = host.bytesOf(native.bodyID).byteLength;
        host.release(native.bodyID);
        if (!type.startsWith("image/") || length === 0) {
          broken.push(`${url} -> HTTP ${native.status} ${type} (${length} bytes)`);
        }
        continue;
      }
      const response = await fetch(url);
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("image/")) {
        broken.push(`${url} -> HTTP ${response.status} ${type}`);
      }
    } catch (error) {
      (isCloudflare(error) ? challenged : broken).push(`${url} -> ${firstLine(error)}`);
    }
  }
  return { broken, challenged };
}

function parseArgs(argv) {
  const args = { names: [], probe: undefined, verbose: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--probe") args.probe = argv[++i];
    else if (!arg.startsWith("-")) args.names.push(arg);
  }
  return args;
}

/**
 * Loads the bundle the way the app does: the HTTP host first, so its operation scope
 * patches the realm's promises before the bundle creates any, then the bundle itself.
 *
 * Every method is then called through `run`, which opens a source operation around it —
 * the thing the app does per call, and what gives a request its owner. A request made
 * outside one is refused by the bundle, and a body read after its operation closed throws,
 * so a source that keeps a response past the end of its method fails here rather than on
 * a device.
 */
function loadTarget(bundlePath) {
  const code = fs.readFileSync(bundlePath, "utf-8");
  const host = createHttpHost();

  const stores = { object: new ManaStore(), secure: new ManaStore() };
  const sandbox = {
    __manaHTTPBridge: host.bridge,
    ObjectStore: stores.object,
    SecureStore: stores.secure,
    WebViewPage: webViewPageFor(() => sandbox.__manaSerializedFunctionPrelude),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    URL,
    Buffer,
    globalThis: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(hostRuntimeSource(), context, { filename: "http-host.generated.js" });
  vm.runInContext(code, context, { filename: path.basename(bundlePath) });

  const Target = context.Target;
  if (!Target) throw new Error(`No Target exported by ${path.basename(bundlePath)}`);
  const ManaHTTP = context.ManaHTTP;
  if (!ManaHTTP?.runHttpOperation) throw new Error("The HTTP host runtime did not install");
  const target = new Target();

  return {
    target,
    host,
    stores,
    run: (callback) => ManaHTTP.runHttpOperation(callback),
    loadImage: (request) => ManaHTTP.runHttpOperation(() => ManaHTTP.loadImage(target, request)),
  };
}

/**
 * Whether the harness — not the source — is what could not do this.
 *
 * `WebViewPage` runs in the browser when one is reachable and falls back to a cheerio
 * document with no JS engine when it is not. A source built around a site that computes
 * what it serves then fails on the stand-in's own limits, and reporting that as FAIL says
 * the source is broken when it may be perfect. It is the same case as a challenge: not
 * checked, so not proven.
 */
function isHarnessLimit(error) {
  // Only the shim's own refusals — `WebViewPage shim: document.x is not available`. A page
  // that loaded and then would not answer is the source's problem, not the harness's, and
  // calling that unverifiable hid the exact bug it was meant to expose.
  return /^WebViewPage shim:/.test(String(error?.message ?? error));
}

function isCloudflare(error) {
  if (!error) return false;
  if (error.name === "CloudflareError") return true;
  const message = String(error.message ?? error);
  return /cloudflare|just a moment|challenge/i.test(message);
}

/** Wraps a step so a Cloudflare block becomes SKIP instead of FAIL. */
async function step(results, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "pass", detail, ms: Date.now() - started });
    return detail;
  } catch (error) {
    const status =
      isCloudflare(error) || isHarnessLimit(error) || error instanceof Skip ? "skip" : "fail";
    const message = String(error?.message ?? error);
    results.push({
      name,
      status,
      detail: message.split("\n")[0],
      // A failure with several causes loses all but the first without this, which
      // leaves a caller — or an agent reading the output — nothing to act on.
      rest: message.split("\n").slice(1),
      ms: Date.now() - started,
    });
    return undefined;
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split(String.fromCharCode(10))[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * How many of these are actually different things.
 *
 * A count is not evidence. A chapter list built by asking for thirty-one pages from a
 * function that ignored the page number came back as 620 entries — twenty distinct ones,
 * repeated — and every check here passed it, printed "620 chapters", and let a source ship
 * that showed twenty on a device. Nothing downstream can tell the difference afterwards,
 * so identity is checked here, where the list is still in hand.
 */
function assertDistinct(items, identify, label) {
  const seen = new Set();
  for (const item of items) {
    const id = identify(item);
    if (id === undefined || id === null || id === "") continue;
    seen.add(String(id));
  }
  assert(
    seen.size === items.length,
    `${label}: ${items.length} returned but only ${seen.size} are distinct — ` +
      `the rest are repeats, which a count alone would have reported as a full list`,
  );
  return seen.size;
}

function checkHighlights(results, label) {
  assert(Array.isArray(results), `${label}: results is not an array`);
  assert(results.length > 0, `${label}: returned 0 results`);
  for (const item of results) {
    assert(item && typeof item.id === "string" && item.id.length > 0, `${label}: item missing id`);
    assert(typeof item.title === "string" && item.title.length > 0, `${label}: item missing title`);
  }
  assertDistinct(results, (item) => item.id, label);
  const withCover = results.filter((item) => item.cover).length;
  return `${results.length} results, ${withCover} with covers`;
}

function checkSearchForm(form) {
  assert(form && Array.isArray(form.sections), "getSearchForm did not return { sections }");
  const ids = [];
  for (const section of form.sections) {
    for (const field of section.children ?? []) ids.push(field.id);
    if (section.field) ids.push(section.field.id);
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert(duplicates.length === 0, `duplicate field ids: ${duplicates.join(", ")}`);
  return `${form.sections.length} sections, ${ids.length} fields`;
}

/** The bundle runs in its own vm realm, so `instanceof Date` would be false here. */
function isValidDate(value) {
  if (!value) return false;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return !Number.isNaN(value.getTime());
  }
  return typeof value.getTime === "function" && !Number.isNaN(value.getTime());
}

function checkChapters(chapters) {
  assert(Array.isArray(chapters), "getChapters did not return an array");
  assert(chapters.length > 0, "getChapters returned 0 chapters");
  chapters.forEach((chapter, index) => {
    assert(typeof chapter.chapterId === "string" && chapter.chapterId, `chapter ${index}: no id`);
    assert(Number.isFinite(chapter.number), `chapter ${index}: number is not finite`);
    assert(chapter.index === index, `chapter ${index}: index is ${chapter.index}, expected ${index}`);
    assert(isValidDate(chapter.date), `chapter ${index}: bad date`);
  });
  // Sites render their chapter list newest-first and `index` has to run from the first
  // chapter, so a list whose numbers only ever fall is that order left unreversed. The
  // shape checks pass on it happily, and the app then offers the newest chapter as the
  // place to start a series the user has never opened.
  const steps = chapters.slice(1).map((c, i) => c.number - chapters[i].number);
  assert(
    !steps.some((s) => s < 0) || steps.some((s) => s > 0),
    `chapters run newest-first (${chapters[0].number} down to ${chapters[chapters.length - 1].number}) — reverse the list so index 0 is the first chapter`,
  );

  assertDistinct(chapters, (chapter) => chapter.chapterId, "getChapters");
  const dated = chapters.filter((c) => c.date.getTime() > 0).length;
  return `${chapters.length} chapters, ${dated} with real dates`;
}

async function verify(name, probe, verbose) {
  const bundlePath = path.join(DIST_SOURCES, `${name}.mana`);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`${bundlePath} not found — run "npm run build" first`);
  }

  const loaded = loadTarget(bundlePath);
  const { target, run, stores } = loaded;
  if (target.onEnvironmentLoaded) await run(() => target.onEnvironmentLoaded());

  const results = [];
  const meta = { name, info: target.info, intents: undefined };
  /** What a user would actually see, gathered for --verbose and the image check. */
  const preview = { sections: [], search: [], content: undefined, chapters: [], pages: [] };

  // A bundle that throws while the build evaluates it still lands in dist/sources/, so
  // every step below can be green on a source the app will never list. And the bits are
  // what the app reads: a method with no bit is a feature that does not exist.
  await step(results, "catalogue", async () => {
    const manifestPath = path.join(ROOT, "dist", "sources.json");
    assert(fs.existsSync(manifestPath), "dist/sources.json not found — run \"npm run build\" first");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const entry = (manifest.sources ?? []).find((s) => s.name === name);
    assert(entry, `${name} is not in dist/sources.json — the build log says why it was dropped`);
    meta.intents = entry.intents;
    const expected = expectedIntents(target);
    const actual = new Set([...INTENT_NAMES.keys()].filter((bit) => (entry.intents >> bit) & 1));
    const missing = [...expected].filter((bit) => !actual.has(bit)).map((bit) => INTENT_NAMES[bit]);
    const extra = [...actual].filter((bit) => !expected.has(bit)).map((bit) => INTENT_NAMES[bit]);
    assert(
      missing.length === 0 && extra.length === 0,
      `intents in dist/sources.json do not match the instance` +
        (missing.length ? `\nnot set: ${missing.join(", ")}` : "") +
        (extra.length ? `\nset without a method: ${extra.join(", ")}` : ""),
    );
    return `${entry.intents} · ${decodeIntents(entry.intents).join(", ")}`;
  });

  await step(results, "info", async () => {
    assert(target.info?.id, "info.id missing");
    assert(target.info?.version, "info.version missing");
    const thumb = target.info.thumbnail ?? "";
    assert(
      !thumb || thumb.startsWith("http") || thumb.includes("/"),
      `thumbnail "${thumb}" is not under assets/ — the repo page will show a placeholder`,
    );
    return `${target.info.id} v${target.info.version}`;
  });

  if (target.getSearchForm) {
    await step(results, "getSearchForm", async () =>
      checkSearchForm(await run(() => target.getSearchForm())),
    );
  }

  if (target.getSortOptions) {
    await step(results, "getSortOptions", async () => {
      const options = await run(() => target.getSortOptions());
      assert(Array.isArray(options) && options.length > 0, "no sort options returned");
      return `${options.length} options`;
    });
  }

  if (target.getPreferenceMenu) {
    await step(results, "getPreferenceMenu", async () => {
      const form = await run(() => target.getPreferenceMenu());
      assert(form && Array.isArray(form.sections), "no sections returned");
      return `${form.sections.length} sections`;
    });
  }

  let sections = [];
  if (target.getSectionsForPage && target.resolvePageSection) {
    // The step's return value is its printed detail, so anything a step needs to hand
    // onwards is stashed here instead — returning the array printed a blank detail.
    await step(results, "getSectionsForPage", async () => {
      const found = await run(() => target.getSectionsForPage({ id: "home" }));
      assert(Array.isArray(found) && found.length > 0, "no sections returned");
      sections = found;
      return `${found.length} sections`;
    });

    if (Array.isArray(sections)) {
      if (target.willResolveSectionsForPage) {
        await step(results, "willResolveSectionsForPage", async () => {
          await run(() => target.willResolveSectionsForPage({ id: "home" }));
          return "ok";
        });
      }
      for (const section of sections) {
        await step(results, `resolvePageSection(${section.id})`, async () => {
          const resolved = await run(() => target.resolvePageSection({ id: "home" }, section.id));
          preview.sections.push({ section, items: resolved?.items ?? [] });
          return checkHighlights(resolved?.items, section.id);
        });
      }
    }
  }

  const searched = await step(results, "search", async () => {
    const page = await run(() => target.search({ page: 1, query: probe.query ?? "" }));
    assert(typeof page?.isLastPage === "boolean", "isLastPage missing");
    preview.search = page.results ?? [];
    return checkHighlights(page.results, "search");
  });

  // A search the probe names under another setting or past the first page. A reader's
  // settings change which files a source reads — Hitomi walks a language's own listing
  // once one is chosen — and page two of a listing is a different byte range from page
  // one, so a check that only ever runs the default search on page one proves neither.
  for (const variant of Array.isArray(probe.searches) ? probe.searches : []) {
    const label = variant.label ?? variant.query ?? variant.listId ?? "variant";
    await step(results, `search(${label})`, async () => {
      const preferences = Object.entries(variant.preferences ?? {});
      for (const [key, value] of preferences) await stores.object.set(key, value);
      try {
        const request = {
          page: variant.page ?? 1,
          query: variant.query ?? "",
          ...(variant.listId ? { listId: variant.listId } : {}),
        };
        const page = await run(() => target.search(request));
        assert(typeof page?.isLastPage === "boolean", "isLastPage missing");
        const summary = checkHighlights(page.results, `search(${label})`);
        // A listing handed back in place of a search has the right shape and the wrong
        // titles, so a variant can say what at least one title must contain.
        if (variant.expect) {
          const pattern = new RegExp(variant.expect, "i");
          const hit = (page.results ?? []).some((item) => pattern.test(String(item?.title ?? "")));
          assert(hit, `no title matches /${variant.expect}/i — the keyword was not searched`);
        }
        return summary;
      } finally {
        for (const [key] of preferences) await stores.object.remove(key);
      }
    });
  }

  const contentId = probe.contentId;
  if (!contentId) {
    results.push({
      name: "getContent",
      status: "skip",
      detail: "no contentId in probe",
      ms: 0,
    });
  } else {
    await step(results, "getContent", async () => {
      const content = await run(() => target.getContent(contentId));
      preview.content = content;
      assert(content?.title, "content.title is empty");
      assert(content?.cover !== undefined, "content.cover missing");
      // Absent, the app opens everything as right-to-left paged manga — wrong for every
      // webtoon and every western comic, and invisible until someone reads one. Said, not
      // failed: a source whose galleries genuinely are right-to-left is correct without it,
      // and a gate here would block putting such a source back the way it was.
      if (content?.recommendedPanelMode === undefined) {
        console.log(
          `      ${DIM}content.recommendedPanelMode is not set, so the app opens this ` +
            `right-to-left — check that is right for what this site carries.${RESET}`,
        );
      }
      const mode =
        content?.recommendedPanelMode === undefined
          ? "no panel mode"
          : (PANEL_MODE[content.recommendedPanelMode] ?? content.recommendedPanelMode);
      return `"${content.title}" · ${mode}${content.cover ? "" : " (no cover)"}`;
    });

    let chapters;
    if (target.getChapters) {
      await step(results, "getChapters", async () => {
        const found = await run(() => target.getChapters(contentId));
        preview.chapters = found ?? [];
        const detail = checkChapters(found);
        chapters = found;
        return detail;
      });
    }

    // `new-source` seeds `"chapterId": ""`, and `??` accepts an empty string — which used
    // to drop getChapterData entirely with no line printed to say so.
    const chapterId =
      probe.chapterId || (Array.isArray(chapters) ? chapters[0]?.chapterId : undefined);

    if (!chapterId) {
      results.push({
        name: "getChapterData",
        status: "skip",
        detail: "no chapterId in probe and no chapters to take one from",
        ms: 0,
      });
    }

    if (chapterId) {
      await step(results, "getChapterData", async () => {
        // Some sources read pages through a third party that may have nothing
        // for a given issue. `"pagesDependOnUpstream": true` in the probe marks
        // that as SKIP-with-reason instead of a failure, so a genuine parsing
        // break still shows up as FAIL.
        let data;
        try {
          data = await run(() => target.getChapterData(contentId, chapterId));
        } catch (error) {
          if (probe.pagesDependOnUpstream) {
            throw new Skip(`upstream has no pages: ${firstLine(error)}`);
          }
          throw error;
        }
        preview.pages = data?.pages ?? [];
        assert(Array.isArray(data?.pages), "pages is not an array");
        assert(data.pages.length > 0, "0 pages returned");
        for (const page of data.pages) {
          assert(page.url || page.raw, "page has neither url nor raw");
        }
        // A chapter of the same page repeated is a reader showing one image forever.
        assertDistinct(data.pages, (page) => page.url ?? page.raw, "getChapterData");
        return `${data.pages.length} pages`;
      });
    }
  }

  // Every rule here encodes a break that shipped green: shapes were fine and the home
  // page was still wrong in the app. Keep adding to it rather than re-learning by hand.
  if (preview.sections.length > 0) {
    await step(results, "home page", async () => {
      const problems = [];

      for (const { section, items } of preview.sections) {
        if (HERO_STYLES.has(section.style) && items.length < MIN_HERO_ITEMS) {
          problems.push(
            `"${section.title}" is a hero with ${items.length} item(s) — the app repeats a single cover across the carousel. Give it a listing to take several from, or pick a non-hero style.`,
          );
        }
        if (items.length > MAX_SECTION_ITEMS) {
          problems.push(
            `"${section.title}" returns ${items.length} items — set \`limit\` on the section so the home row stays short. \`load\` keeps returning full pages for view-more.`,
          );
        }
        if (items.length === 0) {
          problems.push(`"${section.title}" returned nothing.`);
        }
      }

      // Two rows with different ids are different rows, whatever they hold today: "latest
      // updates" and "manhwa raw" coincide whenever the newest uploads are all raws, and
      // "this week" and "this month" whenever nothing new broke through. What each asks the
      // site is not visible from here, so nothing is compared across rows.

      assert(
        problems.length === 0,
        `${problems.length} problem(s) on the home page\n${problems.join("\n")}`,
      );
      return `${preview.sections.length} sections, none empty or overlong`;
    });
  }

  // Shape checks pass happily on a cover URL that 404s, which is a blank grid for the
  // user. Sample a few of the URLs the source actually produced and fetch them.
  const sampled = [
    ...preview.sections.flatMap((entry) =>
      entry.items.slice(0, 1).map((item) => ({ url: item.cover, origin: ORIGIN.Cover })),
    ),
    { url: preview.search[0]?.cover, origin: ORIGIN.Cover },
    { url: preview.content?.cover, origin: ORIGIN.Cover },
    { url: preview.pages[0]?.url, origin: ORIGIN.Page },
  ].filter(({ url }) => typeof url === "string" && url.startsWith("http"));

  if (sampled.length > 0) {
    await step(results, "images", async () => {
      const { broken, challenged } = await checkImageUrls(sampled, loaded);
      // A chapter page that does not serve is a reader that cannot read: always a failure.
      // A cover is the site's own data, and one dead cover in a sample of twenty is a title
      // whose upstream image has gone — mangaball's covers are proxied from mangaupdates,
      // which drops them — not a source that builds its URLs wrong. That is when more than
      // one of the sample fails, and that still fails here.
      const pageUrl = preview.pages[0]?.url;
      const deadPage = broken.filter((line) => pageUrl && line.startsWith(pageUrl));
      assert(deadPage.length === 0, `unreachable chapter page:\n      ${deadPage.join("\n      ")}`);
      assert(
        broken.length <= 1,
        `unreachable image(s):\n      ${broken.join("\n      ")}`,
      );
      if (challenged.length > 0) {
        throw new Skip(
          `${challenged.length} of ${sampled.length} behind a Cloudflare challenge the harness cannot clear — try them in the app\n      ${challenged.join("\n      ")}`,
        );
      }
      if (broken.length === 1) {
        return `${sampled.length} sampled, one cover not served — ${broken[0]}`;
      }
      return `${sampled.length} sampled, all served`;
    });
  }

  return { meta, results, verbose, preview };
}

/** Prints what the app would put in front of the user, for a human to judge. */
function renderPreview(preview) {
  const line = (text) => process.stdout.write(`${text}\n`);
  const tile = (item, indent) => {
    line(`${indent}${item.title}`);
    if (item.subtitle) line(`${indent}${DIM}${item.subtitle}${RESET}`);
  };

  if (preview.sections.length > 0) {
    line(`\n  ${DIM}home page${RESET}`);
    const ids = new Map();
    for (const { section, items } of preview.sections) {
      const style = SECTION_STYLE[section.style] ?? `style ${section.style}`;
      const more = section.viewMoreLink ? "view more" : "no view more";
      line(`    ${section.title}  ${DIM}${style}, ${items.length} items, ${more}${RESET}`);
      for (const item of items.slice(0, 3)) tile(item, "      ");
      for (const item of items) ids.set(item.id, (ids.get(item.id) ?? 0) + 1);
    }
    const repeated = [...ids.values()].filter((n) => n > 1).length;
    if (repeated > 0) {
      line(`    ${DIM}${repeated} title(s) appear in more than one section${RESET}`);
    }
  }

  if (preview.search.length > 0) {
    line(`\n  ${DIM}search${RESET}`);
    for (const item of preview.search.slice(0, 3)) tile(item, "    ");
  }

  const content = preview.content;
  if (content) {
    line(`\n  ${DIM}title view${RESET}`);
    line(`    ${content.title}`);
    const status = PUBLICATION_STATUS[content.status] ?? content.status ?? "unset";
    const rating = CONTENT_RATING[content.contentRating] ?? content.contentRating ?? "unset";
    line(`    ${DIM}${status} · ${rating} · ${content.tags?.length ?? 0} tags${RESET}`);
    const summary = (content.summary ?? "").replace(/\s+/g, " ").trim();
    line(`    ${DIM}summary: ${summary ? `${summary.slice(0, 160)}${summary.length > 160 ? "…" : ""}` : "(empty)"}${RESET}`);
    if (content.tags?.length) {
      line(`    ${DIM}tags: ${content.tags.slice(0, 8).map((t) => t.title).join(", ")}${RESET}`);
    }
  }

  if (preview.chapters.length > 0) {
    const first = preview.chapters[0];
    line(`\n  ${DIM}chapters${RESET}`);
    line(`    ${preview.chapters.length} chapter(s); first: ${first.title ?? `#${first.number}`} ${DIM}(${new Date(first.date).toISOString().slice(0, 10)})${RESET}`);
  }

  if (preview.pages.length > 0) {
    line(`\n  ${DIM}pages${RESET}`);
    line(`    ${preview.pages.length} page(s); first: ${preview.pages[0].url ?? "(raw)"}`);
  }
}

function report(name, results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  console.log(`\n${name}`);
  for (const result of results) {
    counts[result.status]++;
    const color = result.status === "pass" ? GREEN : result.status === "fail" ? RED : YELLOW;
    const mark = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIP";
    const detail =
      typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? "" : "";
    console.log(
      `  ${color}${mark}${RESET} ${result.name.padEnd(32)} ${DIM}${detail} (${result.ms}ms)${RESET}`,
    );
    for (const line of result.rest ?? []) {
      if (line.trim()) console.log(`      ${DIM}${line.trim()}${RESET}`);
    }
  }
  return counts;
}

function loadProbe(name, override) {
  const probePath = override ?? path.join(ROOT, "scripts", "probes", `${name}.json`);
  if (!fs.existsSync(probePath)) return {};
  return JSON.parse(fs.readFileSync(probePath, "utf-8"));
}

function sourceDirs() {
  const manifestPath = path.join(ROOT, "dist", "sources.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return (manifest.sources ?? []).map((s) => s.name).filter((n) => n !== "Template");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.all ? sourceDirs() : args.names;

  if (names.length === 0) {
    console.error("usage: node scripts/verify-source.mjs <Name> [--probe path] | --all");
    process.exit(2);
  }

  const totals = { pass: 0, fail: 0, skip: 0 };

  for (const name of names) {
    const probe = loadProbe(name, args.probe);
    try {
      const { results, preview } = await verify(name, probe, args.verbose);
      const counts = report(name, results);
      if (args.verbose) renderPreview(preview);
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.skip += counts.skip;
    } catch (error) {
      console.log(`\n${name}\n  ${RED}FAIL${RESET} could not load: ${error.message}`);
      totals.fail++;
    }
  }

  // Worth saying plainly: these checks only passed because the request went round through
  // a browser. The source did nothing different, but the app will be on its own.
  if (assisted.length > 0) {
    console.log(
      `\n${YELLOW}${assisted.length} request(s) cleared a challenge through your browser${RESET}`,
    );
    for (const url of assisted) console.log(`  ${DIM}${url}${RESET}`);
  }
  closeBrowser();

  console.log(
    `\n${GREEN}${totals.pass} passed${RESET}, ${RED}${totals.fail} failed${RESET}, ${YELLOW}${totals.skip} skipped${RESET}`,
  );
  process.exit(totals.fail > 0 ? 1 : 0);
}

main();
