import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  SearchMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type NetworkRequest,
  type Option,
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
  type SourceContext,
  type SourceInfo,
  type StaffItem,
  type Tag,
} from "@mana-app/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { HTML_ACCEPT, buildClient } from "./client.ts";
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
  ANY,
  BASE_URL,
  CONTENT_TYPE_BY_TAG,
  FilterID,
  ListID,
  MATURE_GENRES,
  POST_TYPE,
  READING_MODE_BY_TYPE,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  STATUS_BY_LABEL,
  SortID,
  TITLE_CACHE_MS,
  TITLE_ROUTE,
  type BrowseQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "madaradex",
  name: "Madaradex",
  version: "1.0.0",
  description: "Pulls manga, manhwa and manhua from madaradex.org",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["madaradex.org"],
};

class MadaradexSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private genreOptions: Option[] | undefined;
  private titleCache: { contentId: string; at: number; document: CheerioAPI } | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 3,
      interval: 1,
      accept: HTML_ACCEPT,
    });
    return this.client;
  }

  private sections(adult: string | undefined): SectionSpec[] {
    return [
      {
        id: ListID.New,
        title: "New Manga",
        subtitle: "The newest series in the catalogue",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.browse({ page, sort: SortID.NewManga, adult }),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just got a new chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Latest, adult }),
      },
      {
        id: ListID.Popular,
        title: "Most Read",
        subtitle: "The titles this site opens most",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Views, adult }),
      },
      {
        id: ListID.TopRated,
        title: "Top Rated",
        subtitle: "Scored highest by readers",
        style: SectionStyle.SimpleTripleRow,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Rating, adult }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: SearchMultiPickerSheet({
        id: FilterID.Genres,
        title: "Genres",
        subtitle: "Matches a title carrying any of these",
        options: await this.genres(),
      }),
      tagsHeader: "Genres",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections(this.adultCeiling(link.context)));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(this.adultCeiling(link.context)), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const ceiling = this.adultCeiling(request.context);

    const list = listResults(this.sections(ceiling), request);
    if (list) return list;

    const filters = new FilterReader(request);
    return this.browse({
      page: pageOf(request),
      query: request.query?.trim() ?? "",
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Relevance),
      genres: filters.options(FilterID.Genres),
      matchAllGenres: filters.toggle(FilterID.MatchAllGenres),
      statuses: filters.options(FilterID.Status),
      adult: chosen(filters.option(FilterID.Adult)) ?? ceiling,
      author: filters.text(FilterID.Author),
      artist: filters.text(FilterID.Artist),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.titlePage(contentId);

    const title = text($(".post-title h1").first());
    if (title === "") {
      throw new Error(
        `Madaradex has no title at "${contentId}". The series may have been unpublished or renamed.`,
      );
    }

    const genres = termsIn($, detail($, "Genre"));
    const tags = termsIn($, detail($, "Tag"));
    const all = [...genres, ...tags];
    const contentType = contentTypeFrom(tags);
    const mode = READING_MODE_BY_TYPE[contentType];
    const status = STATUS_BY_LABEL[text(detail($, "Status")).toLowerCase()];
    const alternatives = splitList(text(detail($, "Alternative")));

    const staff = [
      ...termsIn($, detail($, "Author")).map((term) => staffItem(term.title, "Author")),
      ...termsIn($, detail($, "Artist")).map((term) => staffItem(term.title, "Artist")),
    ].filter((item): item is StaffItem => item !== undefined);

    return {
      title,
      cover: absolute(imageSrc($(".summary_image img").first())),
      summary: summaryOf($),
      tags: all,
      contentType,
      contentRating: ratingFor(isAdultPage($), all),
      webUrl: titleUrl(contentId),
      ...(status === undefined ? {} : { status }),
      ...(mode === undefined ? {} : { recommendedPanelMode: mode }),
      ...(alternatives.length === 0 ? {} : { additionalTitles: alternatives }),
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
    const $ = await this.titlePage(contentId);

    // The list is rendered newest-first and `index` has to run from the first chapter, so
    // it is reversed before anything is assigned an index.
    const entries = $("li.wp-manga-chapter").toArray().reverse();
    const chapters: Chapter[] = [];

    for (const node of entries) {
      const entry = $(node);
      const link = entry.find("a").first();
      const chapterId = lastSegment(link.attr("href"));
      if (chapterId === "") continue;

      const title = text(link);
      chapters.push({
        chapterId,
        number: chapterNumber(title, chapters.length + 1),
        index: chapters.length,
        date: releaseDate($, entry) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: title || `Chapter ${chapters.length + 1}`,
        webUrl: chapterUrl(contentId, chapterId),
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        `Madaradex lists no chapters for "${contentId}". The series may have been unpublished or renamed.`,
      );
    }
    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.page(chapterUrl(contentId, chapterId));

    const pages: ChapterPage[] = $(".reading-content .page-break img")
      .toArray()
      .map((node) => absolute(imageSrc($(node))))
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(`Madaradex returned no pages for "${chapterId}" of "${contentId}".`);
    }
    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Chapter pages live on cdn.madaradex.org, which answers 403 with the site's own error
    // page unless the request carries madaradex.org as its referer. Covers are served from
    // the site itself and do not need it, but the header costs them nothing.
    //
    // Sending `origin` alongside it puts the 403 back: the CDN reads an origin as a
    // cross-site XHR and refuses, where a bare referer reads as an <img> on the page.
    return {
      url: imageURL,
      headers: { referer: `${BASE_URL}/` },
    };
  }

  private async browse(query: BrowseQuery): Promise<PagedSearchResult> {
    const $ = await this.page(browseUrl(query));
    const results = highlightsFrom($);
    const pages = totalPages($);

    return {
      results,
      isLastPage: results.length === 0 || query.page >= pages,
    };
  }

  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;

    const $ = await this.page(`${BASE_URL}/all/`);
    const options = $(".genres_wrap a[href*='/genre/']")
      .toArray()
      // Each row reads "Action (74)"; the count belongs to the index, not to the option.
      .map((node) => ({
        id: lastSegment($(node).attr("href")),
        title: text($(node)).replace(/\s*\(\s*[\d,]+\s*\)\s*$/, ""),
      }))
      .filter((option) => option.id !== "" && option.title !== "");

    if (options.length === 0) {
      throw new Error("Madaradex published no genre list on /all/; the filter cannot be built.");
    }

    this.genreOptions = options;
    return options;
  }

  /**
   * The whole chapter list is inline on the title page, so `getContent` and `getChapters`
   * would otherwise fetch the same document twice back to back — 400 KB each on a long
   * series. The window is short enough that a chapter posted between the two calls is the
   * only thing it can hide, and that one arrives on the next open.
   */
  private async titlePage(contentId: string): Promise<CheerioAPI> {
    const cached = this.titleCache;
    if (cached?.contentId === contentId && Date.now() - cached.at < TITLE_CACHE_MS) {
      return cached.document;
    }

    const document = await this.page(titleUrl(contentId));
    this.titleCache = { contentId, at: Date.now(), document };
    return document;
  }

  private async page(url: string): Promise<CheerioAPI> {
    const response = await this.http.get(url, {
      // Paging past the last page answers 404 with an empty listing, which is the end of
      // the list rather than a failure — the parsers report zero rows for it either way.
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return load(response.data);
  }

  /**
   * The host's rating policy has no equivalent on this site beyond its own adult flag, so
   * a policy that permits nothing above SUGGESTIVE becomes `adult=0`.
   */
  private adultCeiling(context: SourceContext | undefined): string | undefined {
    const allowed = context?.allowedContentRatings;
    if (!allowed || allowed.length === 0) return undefined;
    const mature =
      allowed.includes(ContentRating.MATURE) || allowed.includes(ContentRating.EXPLICIT);
    return mature ? undefined : "0";
  }
}

// -- site shapes -------------------------------------------------------------

function titleUrl(contentId: string): string {
  return `${BASE_URL}/${TITLE_ROUTE}/${encodeURIComponent(contentId)}`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  return `${titleUrl(contentId)}/${encodeURIComponent(chapterId)}`;
}

/** A picker's "Any" row means "omit the parameter", which is not a value the site takes. */
function chosen(value: string): string | undefined {
  return value === "" || value === ANY ? undefined : value;
}

/**
 * `withQuery` builds a `Record`, so the repeated `genre[]` / `status[]` keys the advanced
 * search takes are appended by hand. `s` is appended the same way because it has to be
 * present even when empty: without it WordPress renders the archive template instead of
 * the search results this parser reads.
 */
function browseUrl(query: BrowseQuery): string {
  const base = query.page > 1 ? `${BASE_URL}/page/${query.page}/` : `${BASE_URL}/`;
  const url = withQuery(base, {
    post_type: POST_TYPE,
    m_orderby: query.sort === SortID.Relevance ? undefined : query.sort,
    op: query.matchAllGenres ? "1" : undefined,
    adult: query.adult,
    author: query.author,
    artist: query.artist,
  });

  const repeated = [
    ...(query.genres ?? []).map((genre) => `genre%5B%5D=${encodeURIComponent(genre)}`),
    ...(query.statuses ?? []).map((status) => `status%5B%5D=${encodeURIComponent(status)}`),
  ];

  return [url, `s=${encodeURIComponent(query.query ?? "")}`, ...repeated].join("&");
}

function totalPages($: CheerioAPI): number {
  const label = text($(".wp-pagenavi .pages").first());
  const parsed = /of\s+([\d,]+)/i.exec(label)?.[1];
  if (parsed === undefined) return 1;
  const pages = Number.parseInt(parsed.replace(/,/g, ""), 10);
  return Number.isFinite(pages) && pages > 0 ? pages : 1;
}

function highlightsFrom($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const node of $(".c-tabs-item__content").toArray()) {
    const row = $(node);
    const link = row.find(".post-title a").first();
    const id = lastSegment(link.attr("href"));
    const title = text(link);
    if (id === "" || title === "") continue;

    const subtitle = [
      text(row.find(".tab-meta .latest-chap .chapter").first()),
      text(row.find(".post-content_item.mg_status .summary-content").first()),
      scoreOf(row),
    ]
      .filter(Boolean)
      .join(" · ");

    results.push({
      id,
      title,
      cover: absolute(imageSrc(row.find(".tab-thumb img").first())),
      webUrl: titleUrl(id),
      ...(subtitle === "" ? {} : { subtitle }),
    });
  }

  return results;
}

function scoreOf(row: Cheerio<AnyNode>): string {
  const score = text(row.find(".tab-meta .rating .score").first());
  return score === "" ? "" : `★ ${score}`;
}

function summaryOf($: CheerioAPI): string {
  const content = $(".description-summary .summary__content").first();
  const paragraphs = content
    .find("p")
    .toArray()
    .map((node) => text($(node)))
    .filter(Boolean);

  // `.text()` on the container runs the paragraphs together into one wall of prose.
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : text(content);
}

function isAdultPage($: CheerioAPI): boolean {
  return ($("body").attr("class") ?? "").split(/\s+/).includes("adult-content");
}

function contentTypeFrom(tags: readonly Tag[]): ContentType {
  for (const tag of tags) {
    const type = CONTENT_TYPE_BY_TAG[tag.title.toLowerCase()];
    if (type !== undefined) return type;
  }
  return ContentType.MANGA;
}

function ratingFor(adult: boolean, tags: readonly Tag[]): ContentRating {
  if (adult) return ContentRating.EXPLICIT;
  const names = tags.map((tag) => tag.title.toLowerCase());
  return MATURE_GENRES.some((genre) => names.includes(genre))
    ? ContentRating.MATURE
    : ContentRating.SAFE;
}

function staffItem(name: string, role: string): StaffItem | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return undefined;
  return additionalInfo.staff.item({ id: `${role}:${trimmed}`, title: trimmed, subtitle: role });
}

// -- parsing -----------------------------------------------------------------

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

function imageSrc(node: Cheerio<AnyNode>): string {
  const attributes = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];
  for (const attribute of attributes) {
    const value = node.attr(attribute)?.trim();
    if (!value) continue;
    const first = value.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}

function absolute(raw: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function lastSegment(href: string | undefined): string {
  const path = (href ?? "").split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last.startsWith("http") ? "" : decodeURIComponent(last);
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Every field on a title page is a `.post-content_item` whose `<h5>` names it. The wording
 * varies between singular and `(s)` forms, so the label is matched by prefix; a positional
 * selector breaks the moment a title is missing one of them.
 */
function detail($: CheerioAPI, label: string): Cheerio<AnyNode> {
  return $(".post-content_item")
    .filter((_, node) => text($(node).find(".summary-heading h5").first()).startsWith(label))
    .first()
    .find(".summary-content")
    .first();
}

function termsIn($: CheerioAPI, block: Cheerio<AnyNode>): Tag[] {
  const links = block.find("a").toArray();
  const names = links.length > 0 ? links.map((node) => text($(node))) : splitList(text(block));

  const seen = new Set<string>();
  const terms: Tag[] = [];
  for (const name of names) {
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    terms.push({ id: name, title: name });
  }
  return terms;
}

function chapterNumber(title: string, fallback: number): number {
  const marked = /(?:chapter|ch\.?|#)\s*(\d+(?:\.\d+)?)/i.exec(title);
  if (marked?.[1]) return Number.parseFloat(marked[1]);
  const trailing = /(\d+(?:\.\d+)?)\s*$/.exec(title);
  if (trailing?.[1]) return Number.parseFloat(trailing[1]);
  return fallback;
}

const MONTHS: readonly string[] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const RELATIVE_UNITS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/** `August 7, 2025`, pinned to UTC so the parsed day does not shift with the device. */
function parseAbsoluteDate(raw: string): Date | undefined {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(raw.trim());
  if (!match) return undefined;

  const month = MONTHS.indexOf((match[1] ?? "").toLowerCase());
  const day = Number.parseInt(match[2] ?? "", 10);
  const year = Number.parseInt(match[3] ?? "", 10);
  if (month < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;

  return new Date(Date.UTC(year, month, day));
}

/** `22 hours ago` — the only date a chapter posted this week carries. */
function parseRelativeDate(raw: string): Date | undefined {
  const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(raw);
  const unit = RELATIVE_UNITS[(match?.[2] ?? "").toLowerCase()];
  const count = Number.parseInt(match?.[1] ?? "", 10);
  if (unit === undefined || !Number.isFinite(count)) return undefined;

  return new Date(Date.now() - count * unit);
}

/**
 * A chapter row carries `<i>August 7, 2025</i>` once it is a week old and an
 * `<a class="c-new-tag" title="22 hours ago">` before that — never both.
 */
function releaseDate($: CheerioAPI, entry: Cheerio<AnyNode>): Date | undefined {
  const cell = entry.find(".chapter-release-date").first();
  const absoluteDate = parseAbsoluteDate(text(cell.find("i").first()));
  if (absoluteDate) return absoluteDate;
  return parseRelativeDate(cell.find("a").first().attr("title") ?? "");
}

export class Target extends MadaradexSource {}
