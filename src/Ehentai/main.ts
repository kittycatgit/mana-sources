import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SectionStyle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Highlight,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceContext,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { HTML_ACCEPT, JSON_ACCEPT, buildClient } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSection,
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ALL_CATEGORY_BITS,
  ANY,
  API_URL,
  BASE_URL,
  CATEGORIES,
  FilterID,
  LANGUAGE_CODES,
  LENGTH_RANGES,
  ListID,
  PAGE_BATCH,
  SEARCH_FIELDS,
  TAGS_FIELD,
  THUMBS_PER_PAGE,
  TOPLIST_PAGE_LIMIT,
  Toplist,
  tagTitle,
  type Category,
  type Gallery,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "ehentai",
  name: "Ehentai",
  version: "1.0.1",
  description: "Reads the doujinshi, manga and image galleries hosted on e-hentai.org",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [
    DefinedLanguages.JAPANESE,
    DefinedLanguages.ENGLISH,
    DefinedLanguages.CHINESE,
    DefinedLanguages.KOREAN,
    DefinedLanguages.SPANISH,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["e-hentai.org"],
};

type Listing = {
  results: Highlight[];
  /** The site's own `var nexturl`; empty on the last page. */
  next: string;
};

class EhentaiSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  /**
   * Listings are cursor-paged, not offset-paged: page N is only reachable through the
   * `next` link page N-1 printed. Each entry maps a listing's first URL to the trail of
   * URLs already walked for it, so the usual forwards paging costs one request a page.
   */
  private readonly trails = new Map<string, string[]>();
  private gallery: Gallery | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 4,
      interval: 1,
      accept: HTML_ACCEPT,
    });
    return this.client;
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular Right Now",
        subtitle: "Recent uploads drawing the most readers",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: () => this.popular(),
      },
      {
        id: ListID.Latest,
        title: "Latest Galleries",
        subtitle: "Everything, in the order it was uploaded",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 12,
        load: (page) => this.browse(`${BASE_URL}/`, page),
      },
      {
        id: ListID.TopYesterday,
        title: "Top Yesterday",
        subtitle: "Yesterday's most-viewed galleries",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.toplist(Toplist.Yesterday, page),
      },
      {
        id: ListID.TopMonth,
        title: "Top This Month",
        subtitle: "The month's most-viewed galleries",
        style: SectionStyle.SimpleTripleRow,
        limit: 12,
        load: (page) => this.toplist(Toplist.Month, page),
      },
      {
        id: ListID.TopAllTime,
        title: "All-Time Favourites",
        subtitle: "The most-viewed galleries the site has ever hosted",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.toplist(Toplist.AllTime, page),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: TAGS_FIELD,
      tagsHeader: "Tags",
      // Listings are always ordered newest first; the site offers no other ordering.
      includeSort: false,
    });
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return this.filtered(await list, request.context);

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);
    const language = filters.option(FilterID.Language, ANY);
    const query = request.query?.trim() ?? "";

    const search: SearchQuery = {
      terms: [
        ...(query === "" ? [] : [query]),
        ...tags.included.map((id) => tagTerm(id, false)),
        ...filters.options(FilterID.Parody).map((id) => tagTerm(id, false)),
        ...(language === ANY ? [] : [tagTerm(language, false)]),
        ...tags.excluded.map((id) => tagTerm(id, true)),
      ],
      categories: filters.options(FilterID.Categories),
      minimumRating: filters.option(FilterID.Rating, ANY),
      length: LENGTH_RANGES[filters.option(FilterID.Length, ANY)],
      requireTorrent: filters.toggle(FilterID.Torrent),
      expungedOnly: filters.toggle(FilterID.Expunged),
    };

    return this.filtered(await this.browse(searchUrl(search), pageOf(request)), request.context);
  }

  async getContent(contentId: string): Promise<Content> {
    const gallery = await this.metadata(contentId);
    const category = categoryByTitle(gallery.category);
    const tags: Tag[] = gallery.tags.map((id) => ({ id, title: tagTitle(id) }));

    return {
      title: gallery.title,
      cover: gallery.thumb,
      summary: summaryOf(gallery),
      tags,
      contentType: category?.type ?? ContentType.MANGA,
      contentRating: category?.rating ?? ContentRating.EXPLICIT,
      recommendedPanelMode: category?.mode ?? ReadingMode.PAGED_COMIC,
      webUrl: contentUrl(contentId),
      // A gallery is a finished upload — nothing is ever added to one. The only thing that
      // happens to it afterwards is being expunged.
      status: gallery.expunged ? PublicationStatus.CANCELLED : PublicationStatus.COMPLETED,
      ...(gallery.japaneseTitle === "" || gallery.japaneseTitle === gallery.title
        ? {}
        : { additionalTitles: [gallery.japaneseTitle] }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const gallery = await this.metadata(contentId);
    if (gallery.fileCount === 0) {
      throw new Error(
        `E-Hentai reports no images in gallery ${contentId}. It may have been expunged.`,
      );
    }

    return [
      {
        chapterId: gallery.gid,
        number: 1,
        index: 0,
        date: gallery.posted ?? new Date(0),
        language: languageOf(gallery.tags),
        title: `Full gallery · ${gallery.fileCount} pages`,
        webUrl: contentUrl(contentId),
      },
    ];
  }

  async getChapterData(contentId: string, _chapterId: string): Promise<ChapterData> {
    const gallery = await this.metadata(contentId);
    const links = await this.pageLinks(contentId, gallery.fileCount);

    if (links.length === 0) {
      throw new Error(
        `E-Hentai listed no page links on ${contentUrl(contentId)}. The gallery may have been removed.`,
      );
    }

    const pages: ChapterPage[] = [];
    for (let start = 0; start < links.length; start += PAGE_BATCH) {
      const batch = links.slice(start, start + PAGE_BATCH);
      for (const url of await Promise.all(batch.map((link) => this.imageOn(link)))) {
        pages.push({ url });
      }
    }
    return { pages };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = contentIdFromUrl(url);
    if (contentId === undefined) return null;

    const gallery = await this.metadata(contentId);
    const category = categoryByTitle(gallery.category);

    return {
      content: {
        id: contentId,
        title: gallery.title,
        cover: gallery.thumb,
        webUrl: contentUrl(contentId),
        contentRating: category?.rating ?? ContentRating.EXPLICIT,
        subtitle: highlightSubtitle(gallery.category, gallery.fileCount, isoDate(gallery.posted)),
      },
    };
  }

  // -- listings --------------------------------------------------------------

  private async popular(): Promise<PagedSearchResult> {
    const listing = await this.listing(`${BASE_URL}/popular`);
    return { results: listing.results, isLastPage: true };
  }

  /**
   * Walks the cursor trail to `page`. A warm trail costs one request; a cold one costs a
   * request per page up to it, because the site publishes no way to jump.
   */
  private async browse(first: string, page: number): Promise<PagedSearchResult> {
    const trail = this.trails.get(first) ?? [first];
    this.trails.set(first, trail);

    let index = Math.min(page, trail.length) - 1;
    let listing = await this.listing(trail[index] ?? first);

    while (index + 1 < page) {
      if (listing.next === "") return { results: [], isLastPage: true };
      if (trail.length === index + 1) trail.push(listing.next);
      index += 1;
      listing = await this.listing(trail[index] ?? listing.next);
    }

    if (listing.next !== "" && trail.length === index + 1) trail.push(listing.next);
    return { results: listing.results, isLastPage: listing.next === "" };
  }

  private async toplist(tl: number, page: number): Promise<PagedSearchResult> {
    const clamped = Math.min(page, TOPLIST_PAGE_LIMIT);
    const listing = await this.listing(
      withQuery(`${BASE_URL}/toplist.php`, { tl, p: clamped - 1 }),
    );
    return {
      results: listing.results,
      isLastPage: clamped >= TOPLIST_PAGE_LIMIT || listing.results.length === 0,
    };
  }

  private async listing(url: string): Promise<Listing> {
    const html = await this.get(url);
    return { results: parseRows(load(html)), next: nextUrl(html) };
  }

  private filtered(page: PagedSearchResult, context: SourceContext | undefined): PagedSearchResult {
    const allowed = context?.allowedContentRatings;
    if (!allowed || allowed.length === 0) return page;
    return {
      ...page,
      results: page.results.filter(
        (result) => result.contentRating === undefined || allowed.includes(result.contentRating),
      ),
    };
  }

  // -- gallery ---------------------------------------------------------------

  private async metadata(contentId: string): Promise<Gallery> {
    const cached = this.gallery;
    if (cached && `${cached.gid}/${cached.token}` === contentId) return cached;

    const [gid, token] = splitContentId(contentId);
    const response = await this.http.post(API_URL, {
      headers: { accept: JSON_ACCEPT, "content-type": "application/json" },
      // The host serialises `body` itself from the content type, so a string here reaches
      // the API JSON-encoded a second time and it answers "No method provided".
      body: { method: "gdata", gidlist: [[gid, token]], namespace: 1 },
      validateStatus: servedStatus,
    });

    const payload = readRecord(safeParse(response.data));
    const error = readString(payload["error"]);
    if (error !== "") {
      throw new Error(`E-Hentai rejected the metadata request for ${contentId}: ${error}`);
    }

    const entry = readRecord(readArray(payload["gmetadata"])[0]);
    if (readString(entry["gid"]) === "") {
      throw new Error(`E-Hentai has no gallery at ${contentUrl(contentId)}.`);
    }

    const gallery = readGallery(entry);
    this.gallery = gallery;
    return gallery;
  }

  private async pageLinks(contentId: string, fileCount: number): Promise<string[]> {
    const url = contentUrl(contentId);
    const pages = Math.max(1, Math.ceil(fileCount / THUMBS_PER_PAGE));
    const links: string[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < pages; index++) {
      const $ = load(await this.get(index === 0 ? url : withQuery(url, { p: index })));
      for (const anchor of $("#gdt a[href*='/s/']").toArray()) {
        const href = absolute($(anchor).attr("href") ?? "");
        if (href !== "" && !seen.has(href)) {
          seen.add(href);
          links.push(href);
        }
      }
    }
    return links;
  }

  private async imageOn(link: string): Promise<string> {
    const $ = load(await this.get(link));
    const url = absolute(imageSrc($("#img").first()));
    if (url === "") {
      throw new Error(`E-Hentai served no image on ${link}. The page may have expired.`);
    }
    return url;
  }

  private async get(url: string): Promise<string> {
    const response = await this.http.get(url, {
      headers: { accept: HTML_ACCEPT },
      validateStatus: servedStatus,
    });
    return response.data;
  }
}

// -- request shapes ----------------------------------------------------------

/**
 * The site answers 451 with the whole page rendered where local law makes it add an age
 * notice — an Australian reader gets every gallery under that status. Treating it as a
 * failure would leave those readers with an empty app.
 */
function servedStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 451;
}

function searchUrl(query: SearchQuery): string {
  return withQuery(`${BASE_URL}/`, {
    f_search: query.terms.join(" "),
    advsearch: 1,
    f_cats: excludedCategoryBits(query.categories),
    f_srdd: query.minimumRating === ANY ? undefined : query.minimumRating,
    f_spf: query.length?.from,
    f_spt: query.length?.to,
    f_sto: query.requireTorrent ? "on" : undefined,
    f_sh: query.expungedOnly ? "on" : undefined,
  });
}

/** `f_cats` names the categories to leave out, so an empty or complete pick means "omit". */
function excludedCategoryBits(selected: readonly string[]): number | undefined {
  if (selected.length === 0 || selected.length === CATEGORIES.length) return undefined;
  const included = CATEGORIES.filter((category) => selected.includes(category.id)).reduce(
    (bits, category) => bits + category.bit,
    0,
  );
  return included === 0 ? undefined : ALL_CATEGORY_BITS - included;
}

/** The site's search grammar: `namespace:"name"$` for an exact tag, `-` in front to exclude. */
function tagTerm(id: string, exclude: boolean): string {
  const prefix = exclude ? "-" : "";
  const separator = id.indexOf(":");
  if (separator < 0) return `${prefix}"${id}"$`;
  return `${prefix}${id.slice(0, separator)}:"${id.slice(separator + 1)}"$`;
}

// -- parsing -----------------------------------------------------------------

/** Every listing — front page, search, category, popular and the toplists — shares this table. */
function parseRows($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const row of $("table.itg tr").toArray()) {
    const $row = $(row);
    const link = $row.find("td.gl3c a[href*='/g/']").first();
    const contentId = contentIdFromUrl(link.attr("href") ?? "");
    if (contentId === undefined || seen.has(contentId)) continue;

    const title = text($row.find("div.glink").first());
    if (title === "") continue;
    seen.add(contentId);

    const category = text($row.find("td.gl1c div").first());
    const posted = text($row.find("[id^='posted_']").first()).slice(0, 10);

    results.push({
      id: contentId,
      title,
      cover: absolute(imageSrc($row.find("td.gl2c img").first())),
      webUrl: contentUrl(contentId),
      contentRating: categoryByTitle(category)?.rating ?? ContentRating.EXPLICIT,
      subtitle: highlightSubtitle(category, pageCount($, $row), posted),
    });
  }
  return results;
}

/**
 * The count sits in a bare `<div>59 pages</div>` that carries no class, and the row prints
 * it twice. Matching a whole element's text is what keeps the timestamp immediately before
 * it — which the markup runs together with no separator — out of the number.
 */
function pageCount($: CheerioAPI, row: Cheerio<AnyNode>): number {
  for (const node of row.find("div").toArray()) {
    const match = /^(\d+) pages?$/.exec(text($(node)));
    if (match !== null) return Number.parseInt(match[1] ?? "", 10);
  }
  return 0;
}

/**
 * The pager is written into an inline script rather than the markup, and it is the only
 * end-of-list signal the site gives: `nexturl` is empty on the last page.
 */
function nextUrl(html: string): string {
  return decodeEntities(/var nexturl\s*=\s*"([^"]*)"/.exec(html)?.[1] ?? "");
}

function highlightSubtitle(category: string, fileCount: number, posted: string): string {
  return [category, fileCount > 0 ? `${fileCount} pages` : "", posted].filter(Boolean).join(" · ");
}

function summaryOf(gallery: Gallery): string {
  const sentences = [
    `${gallery.category} uploaded by ${gallery.uploader || "an anonymous member"}${
      postedLabel(gallery) === "" ? "" : ` on ${postedLabel(gallery)}`
    }.`,
    `${gallery.fileCount} pages, ${formatSize(gallery.fileSize)}.`,
  ];

  if (gallery.rating > 0) sentences.push(`Rated ${gallery.rating.toFixed(2)} out of 5 by readers.`);
  if (gallery.torrentCount > 0) {
    sentences.push(
      `${gallery.torrentCount} torrent${gallery.torrentCount === 1 ? "" : "s"} available.`,
    );
  }
  if (gallery.expunged) sentences.push("This gallery has been expunged from the archive.");

  return sentences.join(" ");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function postedLabel(gallery: Gallery): string {
  const posted = gallery.posted;
  if (posted === undefined) return "";
  return `${posted.getUTCDate()} ${MONTHS[posted.getUTCMonth()]} ${posted.getUTCFullYear()}`;
}

/** Listing rows print the posted date this way, so a tile built from the API matches them. */
function isoDate(date: Date | undefined): string {
  return date === undefined ? "" : date.toISOString().slice(0, 10);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The site tags a translation but never the original: an untagged gallery is Japanese. */
function languageOf(tags: readonly string[]): string {
  const languages = tags
    .filter((tag) => tag.startsWith("language:"))
    .map((tag) => tag.slice("language:".length))
    .filter((name) => name !== "translated" && name !== "rewrite");

  const named = languages[0];
  if (named === undefined) return DefinedLanguages.JAPANESE;
  return LANGUAGE_CODES[named] ?? DefinedLanguages.UNIVERSAL;
}

function categoryByTitle(title: string): Category | undefined {
  const wanted = title.trim().toLowerCase();
  return CATEGORIES.find((category) => category.title.toLowerCase() === wanted);
}

function contentUrl(contentId: string): string {
  const [gid, token] = splitContentId(contentId);
  return `${BASE_URL}/g/${gid}/${token}/`;
}

function contentIdFromUrl(url: string): string | undefined {
  const match = /\/g\/(\d+)\/([0-9a-f]+)/i.exec(url);
  if (match === null) return undefined;
  return `${match[1]}/${match[2]}`;
}

function splitContentId(contentId: string): [string, string] {
  const separator = contentId.indexOf("/");
  if (separator < 0) return [contentId, ""];
  return [contentId.slice(0, separator), contentId.slice(separator + 1)];
}

// -- readers -----------------------------------------------------------------

function readGallery(entry: Record<string, unknown>): Gallery {
  const posted = readNumber(entry["posted"]);
  return {
    gid: readString(entry["gid"]),
    token: readString(entry["token"]),
    title: readString(entry["title"]),
    japaneseTitle: readString(entry["title_jpn"]),
    category: readString(entry["category"]),
    thumb: absolute(readString(entry["thumb"])),
    uploader: readString(entry["uploader"]),
    posted: posted === undefined ? undefined : new Date(posted * 1000),
    fileCount: readNumber(entry["filecount"]) ?? 0,
    fileSize: readNumber(entry["filesize"]) ?? 0,
    expunged: entry["expunged"] === true,
    rating: readNumber(entry["rating"]) ?? 0,
    torrentCount: readNumber(entry["torrentcount"]) ?? 0,
    tags: readArray(entry["tags"]).map(readString).filter(Boolean),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// -- markup helpers ----------------------------------------------------------

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

function imageSrc(node: Cheerio<AnyNode>): string {
  for (const attribute of ["data-src", "data-original", "data-lazy-src", "srcset", "src"]) {
    const value = node.attr(attribute)?.trim();
    if (!value || value.startsWith("data:")) continue;
    return (value.split(",")[0] ?? "").trim().split(" ")[0] ?? "";
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

/** The inline pager URL is HTML-escaped; there is no `DOMParser` to unescape it with. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export class Target extends EhentaiSource {}
