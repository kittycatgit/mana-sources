import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type StaffItem,
  type Tag,
} from "@mana-app/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { buildClient } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSection,
  resolveSortId,
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  BASE_URL,
  CATEGORY_OPTIONS,
  CONTENT_TYPE_BY_CATEGORY,
  EXTENSION_BY_TYPE,
  FilterID,
  InfoLabel,
  LANGUAGE_BY_NAME,
  LANGUAGE_OPTIONS,
  ListID,
  PAGE_SIZE,
  READING_MODE_BY_CATEGORY,
  SEARCH_FIELDS,
  SEARCH_URL,
  SECONDS_BY_UNIT,
  SORT_OPTIONS,
  SORT_PARAMS,
  SortID,
  type GalleryInfo,
  type ListingQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "imhentai",
  name: "Imhentai",
  version: "1.0.0",
  description: "Browses the doujinshi, manga and artist CG galleries on imhentai.xxx",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.JAPANESE,
    DefinedLanguages.SPANISH,
    DefinedLanguages.FRENCH,
    DefinedLanguages.KOREAN,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["imhentai.xxx"],
};

class ImhentaiSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private gallery: { contentId: string; html: string } | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 3, interval: 1 });
    return this.client;
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular Now",
        subtitle: "What the site is reading this week",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.listing({ page, sort: SortID.Popular }),
      },
      {
        id: ListID.Latest,
        title: "Latest Uploads",
        subtitle: "Everything as it lands, newest first",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 12,
        load: (page) => this.listing({ page, sort: SortID.Latest }),
      },
      {
        id: ListID.TopRated,
        title: "Top Rated",
        subtitle: "Scored highest by readers",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ page, sort: SortID.TopRated }),
      },
      {
        id: ListID.NewManga,
        title: "New Manga",
        subtitle: "Fresh full-length manga",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ page, sort: SortID.Latest, categories: ["m"] }),
      },
      {
        id: ListID.NewWestern,
        title: "New Western",
        subtitle: "Recent western comics",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ page, sort: SortID.Latest, categories: ["w"] }),
      },
      {
        id: ListID.NewArtistCG,
        title: "New Artist CG",
        subtitle: "The latest artist collections",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ page, sort: SortID.Latest, categories: ["a"] }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Separate several tags in the search box with commas.",
      fields: SEARCH_FIELDS,
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return list;

    const filters = new FilterReader(request);
    return this.listing({
      page: pageOf(request),
      key: request.query?.trim() ?? "",
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      categories: filters.options(FilterID.Categories),
      languages: filters.options(FilterID.Languages),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const gallery = parseGallery(await this.galleryHtml(contentId), contentId);

    const category = firstTitle(gallery, InfoLabel.Category);
    const languages = titlesOf(gallery, InfoLabel.Languages);
    const artists = titlesOf(gallery, InfoLabel.Artists);
    const groups = titlesOf(gallery, InfoLabel.Groups);
    const parodies = titlesOf(gallery, InfoLabel.Parodies);

    const tags: Tag[] = [
      ...(gallery.fields[InfoLabel.Tags] ?? []),
      ...(gallery.fields[InfoLabel.Parodies] ?? []),
    ].map((entry) => ({ id: entry.id, title: entry.title }));

    const staff = [
      ...artists.map((name) => staffItem(name, "Artist")),
      ...groups.map((name) => staffItem(name, "Group")),
    ];

    const key = category.toLowerCase();
    const mode = READING_MODE_BY_CATEGORY[key];
    const categoryTitle = CATEGORY_OPTIONS.find((option) => option.title.toLowerCase() === key);

    return {
      title: gallery.title || contentId,
      cover: gallery.cover,
      summary: summaryOf(
        gallery,
        categoryTitle?.title ?? category,
        languages,
        artists,
        groups,
        parodies,
      ),
      tags,
      status: statusOf(gallery.title),
      contentType: CONTENT_TYPE_BY_CATEGORY[key] ?? ContentType.COMIC,
      contentRating: ContentRating.EXPLICIT,
      webUrl: galleryUrl(contentId),
      ...(mode === undefined ? {} : { recommendedPanelMode: mode }),
      ...(gallery.alternateTitle === "" ? {} : { additionalTitles: [gallery.alternateTitle] }),
      ...(staff.length === 0
        ? {}
        : {
            additionalInfo: [
              additionalInfo.staff.section({
                id: "credits",
                title: "Credits",
                hasMore: false,
                items: staff,
              }),
            ],
          }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const gallery = parseGallery(await this.galleryHtml(contentId), contentId);
    const language = languageCodeOf(titlesOf(gallery, InfoLabel.Languages));

    // A gallery is one finished work, not a series — the whole thing is a single chapter.
    return [
      {
        chapterId: "1",
        number: 1,
        index: 0,
        date: parsePostedDate(gallery.posted, Date.now()) ?? new Date(0),
        language,
        title: gallery.pageCount > 0 ? `Gallery (${gallery.pageCount} pages)` : "Gallery",
        webUrl: galleryUrl(contentId),
      },
    ];
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const html = await this.galleryHtml(contentId);
    const gallery = parseGallery(html, contentId);
    const pages = parsePages(html, gallery);

    if (pages.length === 0) {
      throw new Error(
        `Imhentai returned no pages for gallery "${contentId}" (chapter ${chapterId}). The gallery page loaded but carried no g_th manifest, so it may have been taken down.`,
      );
    }
    return { pages };
  }

  private async listing(query: ListingQuery): Promise<PagedSearchResult> {
    const page = pageOf({ page: query.page });
    const response = await this.http.get(withQuery(SEARCH_URL, listingParams(query, page)));
    return parseListing(response.data, page);
  }

  private async galleryHtml(contentId: string): Promise<string> {
    if (this.gallery?.contentId === contentId) return this.gallery.html;

    const url = galleryUrl(contentId);
    let html: string;
    try {
      html = (await this.http.get(url)).data;
    } catch (error) {
      // Cloudflare challenges every route on this site except /search/, so the gallery page
      // is only reachable through the WebView carrying the clearance the user established
      // via config.cloudflareResolutionURL.
      if (!(error instanceof CloudflareError)) throw error;
      html = await renderPage(url);
    }

    if (!html.includes("galleries_info")) {
      throw new Error(`Imhentai has no gallery at "${contentId}", or the page did not load.`);
    }

    this.gallery = { contentId, html };
    return html;
  }
}

// -- requests ----------------------------------------------------------------

function galleryUrl(contentId: string): string {
  return `${BASE_URL}/gallery/${encodeURIComponent(contentId)}/`;
}

async function renderPage(url: string): Promise<string> {
  const page = await WebViewPage.create();
  await page.goto(url, { waitUntil: "load" });
  // evaluateScript, not evaluate: the callback form runs in the page, so its `document`
  // does not typecheck against a source tsconfig that has no DOM lib.
  return page.evaluateScript<string>("document.documentElement.outerHTML");
}

/**
 * The category and language checkboxes only filter when the whole group is submitted with
 * an explicit 1 or 0 per member; a lone `m=1` is accepted and returns the unfiltered
 * listing, which reads as the site ignoring the facet.
 */
function group(
  options: readonly { id: string }[],
  selected: readonly string[] | undefined,
): Record<string, number> {
  if (!selected || selected.length === 0) return {};
  const params: Record<string, number> = {};
  for (const option of options) params[option.id] = selected.includes(option.id) ? 1 : 0;
  return params;
}

function listingParams(query: ListingQuery, page: number): Record<string, string | number> {
  const sort = query.sort ?? SortID.Latest;
  const flags: Record<string, number> = {};
  for (const [id, param] of Object.entries(SORT_PARAMS)) flags[param] = id === sort ? 1 : 0;

  return {
    key: query.key ?? "",
    ...flags,
    ...group(CATEGORY_OPTIONS, query.categories),
    ...group(LANGUAGE_OPTIONS, query.languages),
    page,
  };
}

// -- listing parsing ---------------------------------------------------------

function parseListing(html: string, page: number): PagedSearchResult {
  const $ = load(html);
  const results: Highlight[] = [];

  for (const element of $("div.thumb").toArray()) {
    const node = $(element);
    const id = galleryIdOf(node.find(".inner_thumb a").first().attr("href") ?? "");
    const title = text(node.find(".caption a").first());
    if (id === "" || title === "") continue;

    const category = text(node.find("a.thumb_cat").first());
    const language = titleCase(
      slugOf(node.find(".cat_flag a[href*='/language/']").first().attr("href") ?? ""),
    );
    const subtitle = [category, language].filter(Boolean).join(" · ");

    results.push({
      id,
      title,
      cover: absolute(imageSrc(node.find(".inner_thumb img").first())),
      contentRating: ContentRating.EXPLICIT,
      webUrl: galleryUrl(id),
      ...(subtitle === "" ? {} : { subtitle }),
    });
  }

  // A query with no matches renders no pager at all, so an absent one is the end of the
  // list rather than a parse failure.
  const last = lastPage($);
  return {
    results,
    isLastPage: last === 0 || page >= last,
    ...(last === 0 ? {} : { totalResultCount: last * PAGE_SIZE }),
  };
}

function lastPage($: CheerioAPI): number {
  let highest = 0;
  for (const element of $("ul.pagination a").toArray()) {
    const match = /[?&](?:amp;)?page=(\d+)/.exec($(element).attr("href") ?? "");
    const page = Number.parseInt(match?.[1] ?? "", 10);
    if (Number.isFinite(page)) highest = Math.max(highest, page);
  }
  return highest;
}

function galleryIdOf(href: string): string {
  return /\/gallery\/(\d+)/.exec(href)?.[1] ?? "";
}

// -- gallery parsing ---------------------------------------------------------

function parseGallery(html: string, contentId: string): GalleryInfo {
  const $ = load(html);
  const fields: Record<string, { id: string; title: string }[]> = {};

  for (const element of $("ul.galleries_info li").toArray()) {
    const node = $(element);
    const label = text(node.find("span.tags_text").first()).replace(/:$/, "").toLowerCase();
    if (label === "") continue;

    fields[label] = node
      .find("a.tag")
      .toArray()
      .map((anchor) => {
        const link = $(anchor);
        const clone = link.clone();
        clone.find("span.badge").remove();
        const title = text(clone);
        return { id: slugOf(link.attr("href") ?? "") || slugify(title), title };
      })
      .filter((entry) => entry.title !== "");
  }

  const pageCount = Number.parseInt(/(\d+)/.exec(text($("li.pages").first()))?.[1] ?? "", 10);

  return {
    fields,
    title: text($("h1").first()),
    alternateTitle: text($("p.subtitle").first()),
    cover: absolute(imageSrc($(".left_cover img").first())),
    pageCount: Number.isFinite(pageCount) ? pageCount : 0,
    posted: text($("li.posted").first()),
    server: $("#load_server").attr("value") ?? "",
    directory: $("#load_dir").attr("value") ?? "",
    loadId: $("#load_id").attr("value") ?? contentId,
  };
}

function parsePages(html: string, gallery: GalleryInfo): ChapterPage[] {
  const manifest = /var\s+g_th\s*=\s*\$\.parseJSON\('([^']*)'\)/.exec(html)?.[1];
  if (manifest === undefined || gallery.server === "" || gallery.directory === "") return [];

  let entries: Record<string, unknown>;
  try {
    entries = JSON.parse(manifest) as Record<string, unknown>;
  } catch {
    return [];
  }

  const base = `https://m${gallery.server}.imhentai.xxx/${gallery.directory}/${gallery.loadId}`;
  return Object.keys(entries)
    .map((key) => Number.parseInt(key, 10))
    .filter((number) => Number.isFinite(number) && number > 0)
    .sort((a, b) => a - b)
    .map((number) => {
      const entry = entries[String(number)];
      const type = typeof entry === "string" ? (entry.split(",")[0] ?? "") : "";
      return { url: `${base}/${number}.${EXTENSION_BY_TYPE[type] ?? "jpg"}` };
    });
}

// -- site shapes -------------------------------------------------------------

function titlesOf(gallery: GalleryInfo, label: string): string[] {
  return (gallery.fields[label] ?? []).map((entry) => entry.title);
}

function firstTitle(gallery: GalleryInfo, label: string): string {
  return titlesOf(gallery, label)[0] ?? "";
}

/** The site publishes no status; a gallery is complete unless an uploader says otherwise. */
function statusOf(title: string): PublicationStatus {
  return /\[\s*ongoing\s*\]/i.test(title) ? PublicationStatus.ONGOING : PublicationStatus.COMPLETED;
}

function languageCodeOf(languages: readonly string[]): string {
  for (const language of languages) {
    const code = LANGUAGE_BY_NAME[language.toLowerCase()];
    if (code !== undefined) return code;
  }
  return DefinedLanguages.UNIVERSAL;
}

function staffItem(name: string, role: string): StaffItem {
  return additionalInfo.staff.item({ id: `${role}:${name}`, title: name, subtitle: role });
}

/** A gallery page carries no description, so the summary is written from its own fields. */
function summaryOf(
  gallery: GalleryInfo,
  category: string,
  languages: readonly string[],
  artists: readonly string[],
  groups: readonly string[],
  parodies: readonly string[],
): string {
  const spoken = languages.filter((language) => language.toLowerCase() !== "translated");
  const opening = [
    gallery.pageCount > 0 ? `A ${gallery.pageCount}-page` : "A",
    category || "gallery",
    category === "" ? "" : "gallery",
    spoken.length === 0 ? "" : `in ${list(spoken.map(titleCase))}`,
    gallery.posted === "" ? "" : `, posted ${gallery.posted.replace(/^Posted:\s*/i, "")}`,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(" ,", ",");

  return [
    `${opening}.`,
    artists.length === 0 ? "" : `Drawn by ${list(artists.map(titleCase))}.`,
    groups.length === 0 ? "" : `Released by ${list(groups.map(titleCase))}.`,
    parodies.length === 0 ? "" : `Parodies ${list(parodies.map(titleCase))}.`,
    gallery.alternateTitle === "" ? "" : `Also known as ${gallery.alternateTitle}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function list(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function parsePostedDate(raw: string, now: number): Date | undefined {
  const match = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(raw);
  const amount = Number.parseInt(match?.[1] ?? "", 10);
  const seconds = SECONDS_BY_UNIT[(match?.[2] ?? "").toLowerCase()];
  if (!Number.isFinite(amount) || seconds === undefined) return undefined;
  return new Date(now - amount * seconds * 1000);
}

// -- parsing helpers ---------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * The site stores titles already-escaped and escapes them again on output, so an apostrophe
 * ships as `&amp;#039;` and cheerio's own decode leaves a literal `&#039;` behind. There is
 * no DOMParser in the runtime, so the second pass is by hand.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, body: string) => {
    const marker = body.slice(0, 2).toLowerCase();
    if (marker === "#x") {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function text(node: Cheerio<AnyNode>): string {
  return decodeEntities(node.text().replace(/\s+/g, " ").trim());
}

function imageSrc(node: Cheerio<AnyNode>): string {
  for (const attribute of ["data-src", "data-original", "data-lazy-src", "srcset", "src"]) {
    const value = node.attr(attribute)?.trim();
    if (!value) continue;
    const first =
      attribute === "srcset" ? (value.split(",")[0] ?? "").trim().split(/\s+/)[0] : value;
    if (first) return first;
  }
  return "";
}

function absolute(raw: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (value === "") return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

/** `/tag/big-breasts/` and `/language/japanese/` both yield their last path segment. */
function slugOf(href: string): string {
  return /\/([^/]+)\/?$/.exec(href.replace(/\/+$/, ""))?.[1] ?? "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string): string {
  return value
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export class Target extends ImhentaiSource {}
