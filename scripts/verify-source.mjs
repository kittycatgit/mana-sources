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
  CloudflareError,
  ManaStore,
  NetworkClient,
  NetworkError,
  WebViewPage,
  decodeIntents,
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

const PUBLICATION_STATUS = { 1: "ONGOING", 2: "COMPLETED", 3: "CANCELLED", 4: "HIATUS" };
const CONTENT_RATING = { 0: "SAFE", 1: "SUGGESTIVE", 2: "MATURE", 3: "EXPLICIT" };

/**
 * Fetches a handful of URLs and reports the ones that do not come back as images.
 *
 * A source with `willRequestImage` is telling the app how to ask for its images — most
 * often a referer a CDN refuses to serve without. Fetching bare would report 403 on a
 * source that works perfectly in the app, so the handler is applied here too.
 */
async function checkImageUrls(urls, target) {
  const broken = [];
  for (const url of urls) {
    try {
      const request = target?.willRequestImage ? await target.willRequestImage(url) : undefined;
      const headers = {};
      for (const [key, value] of Object.entries(request?.headers ?? {})) {
        headers[key] = String(value);
      }
      const response = await fetch(request?.url ?? url, { headers });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("image/")) {
        broken.push(`${url} -> HTTP ${response.status} ${type}`);
      }
    } catch (error) {
      broken.push(`${url} -> ${firstLine(error)}`);
    }
  }
  return broken;
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

function loadTarget(bundlePath) {
  const code = fs.readFileSync(bundlePath, "utf-8");
  const store = new ManaStore();

  const sandbox = {
    NetworkClient,
    NetworkError,
    CloudflareError,
    ObjectStore: store,
    SecureStore: new ManaStore(),
    WebViewPage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    AbortController,
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
  vm.runInContext(code, context, { filename: path.basename(bundlePath) });

  const Target = context.Target;
  if (!Target) throw new Error(`No Target exported by ${path.basename(bundlePath)}`);
  return new Target();
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
    const status = isCloudflare(error) || error instanceof Skip ? "skip" : "fail";
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

function checkHighlights(results, label) {
  assert(Array.isArray(results), `${label}: results is not an array`);
  assert(results.length > 0, `${label}: returned 0 results`);
  for (const item of results) {
    assert(item && typeof item.id === "string" && item.id.length > 0, `${label}: item missing id`);
    assert(typeof item.title === "string" && item.title.length > 0, `${label}: item missing title`);
  }
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
  const dated = chapters.filter((c) => c.date.getTime() > 0).length;
  return `${chapters.length} chapters, ${dated} with real dates`;
}

async function verify(name, probe, verbose) {
  const bundlePath = path.join(DIST_SOURCES, `${name}.mana`);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`${bundlePath} not found — run "npm run build" first`);
  }

  const target = loadTarget(bundlePath);
  if (target.onEnvironmentLoaded) await target.onEnvironmentLoaded();

  const results = [];
  const meta = { name, info: target.info, intents: undefined };
  /** What a user would actually see, gathered for --verbose and the image check. */
  const preview = { sections: [], search: [], content: undefined, chapters: [], pages: [] };

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
    await step(results, "getSearchForm", async () => checkSearchForm(await target.getSearchForm()));
  }

  if (target.getSortOptions) {
    await step(results, "getSortOptions", async () => {
      const options = await target.getSortOptions();
      assert(Array.isArray(options) && options.length > 0, "no sort options returned");
      return `${options.length} options`;
    });
  }

  if (target.getPreferenceMenu) {
    await step(results, "getPreferenceMenu", async () => {
      const form = await target.getPreferenceMenu();
      assert(form && Array.isArray(form.sections), "no sections returned");
      return `${form.sections.length} sections`;
    });
  }

  let sections = [];
  if (target.getSectionsForPage && target.resolvePageSection) {
    sections =
      (await step(results, "getSectionsForPage", async () => {
        const found = await target.getSectionsForPage({ id: "home" });
        assert(Array.isArray(found) && found.length > 0, "no sections returned");
        return found;
      })) ?? [];

    if (Array.isArray(sections)) {
      if (target.willResolveSectionsForPage) {
        await step(results, "willResolveSectionsForPage", async () => {
          await target.willResolveSectionsForPage({ id: "home" });
          return "ok";
        });
      }
      for (const section of sections) {
        await step(results, `resolvePageSection(${section.id})`, async () => {
          const resolved = await target.resolvePageSection({ id: "home" }, section.id);
          preview.sections.push({ section, items: resolved?.items ?? [] });
          return checkHighlights(resolved?.items, section.id);
        });
      }
    }
  }

  const searched = await step(results, "search", async () => {
    const page = await target.search({ page: 1, query: probe.query ?? "" });
    assert(typeof page?.isLastPage === "boolean", "isLastPage missing");
    preview.search = page.results ?? [];
    return checkHighlights(page.results, "search");
  });

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
      const content = await target.getContent(contentId);
      preview.content = content;
      assert(content?.title, "content.title is empty");
      assert(content?.cover !== undefined, "content.cover missing");
      return `"${content.title}"${content.cover ? "" : " (no cover)"}`;
    });

    let chapters;
    if (target.getChapters) {
      chapters = await step(results, "getChapters", async () => {
        const found = await target.getChapters(contentId);
        preview.chapters = found ?? [];
        checkChapters(found);
        return found;
      });
    }

    const chapterId =
      probe.chapterId ?? (Array.isArray(chapters) ? chapters[0]?.chapterId : undefined);

    if (chapterId) {
      await step(results, "getChapterData", async () => {
        // Some sources read pages through a third party that may have nothing
        // for a given issue. `"pagesDependOnUpstream": true` in the probe marks
        // that as SKIP-with-reason instead of a failure, so a genuine parsing
        // break still shows up as FAIL.
        let data;
        try {
          data = await target.getChapterData(contentId, chapterId);
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

      // Two sections showing the same tiles in the same order are one query wearing
      // two titles — usually a copied `load` that never had its sort changed.
      for (let i = 0; i < preview.sections.length; i++) {
        for (let j = i + 1; j < preview.sections.length; j++) {
          const a = preview.sections[i];
          const b = preview.sections[j];
          const headA = a.items.slice(0, 5).map((item) => item.id);
          const headB = b.items.slice(0, 5).map((item) => item.id);
          if (headA.length > 0 && headA.join("\u0000") === headB.join("\u0000")) {
            problems.push(
              `"${a.section.title}" and "${b.section.title}" open with the same titles in the same order — they are running the same query.`,
            );
          }
        }
      }

      assert(
        problems.length === 0,
        `${problems.length} problem(s) on the home page\n${problems.join("\n")}`,
      );
      return `${preview.sections.length} sections, none repeating or overlong`;
    });
  }

  // Shape checks pass happily on a cover URL that 404s, which is a blank grid for the
  // user. Sample a few of the URLs the source actually produced and fetch them.
  const sampled = [
    ...preview.sections.flatMap((entry) => entry.items.slice(0, 1).map((item) => item.cover)),
    preview.search[0]?.cover,
    preview.content?.cover,
    preview.pages[0]?.url,
  ].filter((url) => typeof url === "string" && url.startsWith("http"));

  if (sampled.length > 0) {
    await step(results, "images", async () => {
      const broken = await checkImageUrls(sampled, target);
      assert(broken.length === 0, `unreachable image(s):\n      ${broken.join("\n      ")}`);
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
