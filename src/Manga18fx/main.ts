import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  SearchPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type Option,
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
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  ANY_GENRE,
  BASE_URL,
  CONTENT_TYPE_BY_TAG,
  EXTRA_GENRES,
  FilterID,
  GENRE_ROUTE,
  ListID,
  POPULAR_ROUTE,
  RAW_ROUTE,
  READING_MODE_BY_TYPE,
  SEARCH_ROUTE,
  STATUS_BY_LABEL,
  TITLE_CACHE_MS,
  TITLE_ROUTE,
  UNCENSORED_GENRE,
  type BrowseQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "manga18fx",
  name: "Manga18fx",
  version: "1.0.0",
  description: "Pulls adult manhwa, manhua and manga from manga18fx.com",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["manga18fx.com"],
};

class Manga18fxSource implements ChapterSource, SearchProvider, PageLinkResolver {
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

  private sections(context: SourceContext | undefined): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular Manhwa",
        subtitle: "The titles this site is read for",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.listing(popularUrl(page), context),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just got a new chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 15,
        load: (page) => this.listing(latestUrl(page), context),
      },
      {
        id: ListID.Raw,
        title: "Manhwa Raw",
        subtitle: "Untranslated Korean releases",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.listing(rawUrl(page), context),
      },
      {
        id: ListID.Uncensored,
        title: "Uncensored",
        subtitle: "Editions published without the mosaic",
        style: SectionStyle.SimpleTripleRow,
        limit: 15,
        load: (page) => this.listing(genreUrl(UNCENSORED_GENRE, page), context),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      // The genre archives and the search results are separate routes on this site and
      // neither reads the other's parameter, so the two cannot be combined.
      footer: "A genre applies when the search box is empty.",
      fields: [
        SearchPickerSheet({
          id: FilterID.Genre,
          title: "Genre",
          options: await this.genres(),
        }),
      ],
      includeSort: false,
    });
  }

  async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections(link.context));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(link.context), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(request.context), request);
    if (list) return list;

    const filters = new FilterReader(request);
    return this.browse(
      {
        page: pageOf(request),
        query: request.query?.trim() ?? "",
        genre: chosen(filters.option(FilterID.Genre)),
      },
      request.context,
    );
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.titlePage(contentId);

    const title = text($(".post-title h1").first());
    if (title === "") {
      // A slug the site does not know redirects to the home page rather than answering
      // 404, so an empty heading is the only "no such title" signal there is.
      throw new Error(
        `Manga18fx has no title at "${contentId}". The series may have been unpublished or renamed.`,
      );
    }

    const tags = termsIn($, $(".genres-content").first());
    const contentType = contentTypeFrom(tags);
    const mode = READING_MODE_BY_TYPE[contentType];
    const status = STATUS_BY_LABEL[text(detail($, "Status")).toLowerCase()];
    const alternatives = splitList(text(detail($, "Alternative")));

    const staff = [
      ...termsIn($, $(".author-content").first()).map((term) => staffItem(term.title, "Author")),
      ...termsIn($, $(".artist-content").first()).map((term) => staffItem(term.title, "Artist")),
    ].filter((item): item is StaffItem => item !== undefined);

    return {
      title,
      cover: absolute(imageSrc($(".summary_image img").first())),
      summary: summaryOf($),
      tags,
      contentType,
      contentRating: isAdultPage($) ? ContentRating.EXPLICIT : ContentRating.MATURE,
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
    const entries = $("#chapterlist .row-content-chapter li").toArray().reverse();
    const chapters: Chapter[] = [];

    for (const node of entries) {
      const entry = $(node);
      const link = entry.find("a.chapter-name").first();
      const chapterId = lastSegment(link.attr("href"));
      if (chapterId === "") continue;

      const title = text(link);
      chapters.push({
        chapterId,
        // A decimal chapter slugifies its point — "Chapter 102.5" lives at
        // /chapter-102-5 — so the number can only come from the link text.
        number: chapterNumber(title, chapters.length + 1),
        index: chapters.length,
        date: parseChapterDate(text(entry.find(".chapter-time").first())) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: title || `Chapter ${chapters.length + 1}`,
        webUrl: chapterUrl(contentId, chapterId),
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        `Manga18fx lists no chapters for "${contentId}". The series may have been unpublished or renamed.`,
      );
    }
    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.page(chapterUrl(contentId, chapterId));

    const pages: ChapterPage[] = $(".read-content .page-break img")
      .toArray()
      .map((node) => absolute(imageSrc($(node))))
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(`Manga18fx returned no pages for "${chapterId}" of "${contentId}".`);
    }
    return { pages };
  }

  /**
   * The search results and the genre archives are separate routes, and each ignores the
   * other's parameter — `/search?q=x&genre=y` returns the plain `q=x` set and
   * `/manga-genre/y?q=x` returns the plain archive. So a query wins and the genre only
   * applies to an empty one; the search form says as much in its footer.
   */
  private async browse(
    query: BrowseQuery,
    context: SourceContext | undefined,
  ): Promise<PagedSearchResult> {
    if (query.query) return this.listing(searchUrl(query.query, query.page), context);
    if (query.genre) return this.listing(genreUrl(query.genre, query.page), context);
    return this.listing(latestUrl(query.page), context);
  }

  private async listing(url: string, context?: SourceContext): Promise<PagedSearchResult> {
    const $ = await this.page(url);
    const results = permitted(highlightsFrom($), context);

    return { results, isLastPage: results.length === 0 || !hasNextPage($) };
  }

  /**
   * The genre vocabulary is only published as the site's own navigation — there is no
   * genre index page, and an unknown slug is a hard 404 — so it is read off the home page
   * and unioned with the handful only ever linked from a title.
   */
  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;

    const $ = await this.page(`${BASE_URL}/`);
    const byId = new Map<string, Option>();

    for (const option of EXTRA_GENRES) byId.set(option.id, { ...option });
    for (const node of $(`a[href*="/${GENRE_ROUTE}/"]`).toArray()) {
      const id = lastSegment($(node).attr("href"));
      const title = text($(node));
      if (id === "" || title === "" || byId.has(id)) continue;
      byId.set(id, { id, title });
    }

    if (byId.size === 0) {
      throw new Error("Manga18fx published no genre links on its home page.");
    }

    const options = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
    this.genreOptions = [ANY_GENRE, ...options];
    return this.genreOptions;
  }

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
      // Paging past the end answers 404 with the listing template and no rows, which is
      // the end of the list rather than a failure — the parser reports zero either way.
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return load(response.data);
  }
}

// -- site shapes -------------------------------------------------------------

function titleUrl(contentId: string): string {
  return `${BASE_URL}/${TITLE_ROUTE}/${encodeURIComponent(contentId)}`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  return `${titleUrl(contentId)}/${encodeURIComponent(chapterId)}`;
}

/** The popular archive is the only route that pages on a query parameter. */
function popularUrl(page: number): string {
  return withQuery(`${BASE_URL}/${POPULAR_ROUTE}`, { page: page > 1 ? String(page) : undefined });
}

function latestUrl(page: number): string {
  return page > 1 ? `${BASE_URL}/page/${page}` : `${BASE_URL}/`;
}

function rawUrl(page: number): string {
  return page > 1 ? `${BASE_URL}/${RAW_ROUTE}/${page}` : `${BASE_URL}/${RAW_ROUTE}`;
}

function genreUrl(genre: string, page: number): string {
  const base = `${BASE_URL}/${GENRE_ROUTE}/${encodeURIComponent(genre)}`;
  return page > 1 ? `${base}/${page}` : base;
}

function searchUrl(query: string, page: number): string {
  return withQuery(`${BASE_URL}/${SEARCH_ROUTE}`, {
    q: query,
    page: page > 1 ? String(page) : undefined,
  });
}

/** A picker's "Any" row means "browse instead", which is not a genre the site has. */
function chosen(value: string): string | undefined {
  return value === "" || value === ANY ? undefined : value;
}

/**
 * The pager renders the "next" row on the last page too, as `li.next.disabled` holding a
 * `<span>` — only the anchor inside it disappears. A result set with no matches at all
 * renders no pager whatsoever.
 */
function hasNextPage($: CheerioAPI): boolean {
  return $(".pagination li.next a").length > 0;
}

function highlightsFrom($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const node of $(".listupd .page-item").toArray()) {
    const row = $(node);
    const link = row.find("h3.tt a").first();
    const id = lastSegment(link.attr("href"));
    const title = text(link) || (link.attr("title") ?? "").trim();
    if (id === "" || title === "") continue;

    const subtitle = [text(row.find(".list-chapter .chapter-item a").first()), scoreOf(row)]
      .filter(Boolean)
      .join(" · ");

    results.push({
      id,
      title,
      cover: absolute(imageSrc(row.find(".thumb-manga img").first())),
      webUrl: titleUrl(id),
      contentRating:
        row.find(".adult-badges").length > 0 ? ContentRating.EXPLICIT : ContentRating.MATURE,
      ...(subtitle === "" ? {} : { subtitle }),
    });
  }

  return results;
}

function scoreOf(row: Cheerio<AnyNode>): string {
  const score = text(row.find(".item-rate span").first());
  return score === "" || score === "0" ? "" : `★ ${score}`;
}

function permitted(results: Highlight[], context: SourceContext | undefined): Highlight[] {
  const allowed = context?.allowedContentRatings;
  if (!allowed || allowed.length === 0) return results;
  return results.filter(
    (result) => result.contentRating === undefined || allowed.includes(result.contentRating),
  );
}

function summaryOf($: CheerioAPI): string {
  const content = $(".panel-story-description .dsct").first();
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
  return ContentType.MANHWA;
}

function staffItem(name: string, role: string): StaffItem | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return undefined;
  return additionalInfo.staff.item({ id: `${role}:${trimmed}`, title: trimmed, subtitle: role });
}

/**
 * Every field on a title page is a `.post-content_item` whose `<h5>` names it. The wording
 * varies — `Author(s)` carries the parenthetical, `Status` does not — so the label is
 * matched by prefix; a positional selector breaks the moment a title is missing one.
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

/** Alternative titles are separated by a slash here, not the comma most templates use. */
function splitList(raw: string): string[] {
  return raw
    .split(/[/,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function chapterNumber(title: string, fallback: number): number {
  const marked = /(?:chapter|ch\.?|#)\s*(\d+(?:\.\d+)?)/i.exec(title);
  if (marked?.[1]) return Number.parseFloat(marked[1]);
  const trailing = /(\d+(?:\.\d+)?)\s*$/.exec(title);
  if (trailing?.[1]) return Number.parseFloat(trailing[1]);
  return fallback;
}

const MONTHS: readonly string[] = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * `04 Sep 26` — the only format a chapter row carries, with a two-digit year throughout
 * the archive. Pinned to UTC so the parsed day does not shift with the device timezone.
 */
function parseChapterDate(raw: string): Date | undefined {
  const match = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/.exec(raw.trim());
  if (!match) return undefined;

  const day = Number.parseInt(match[1] ?? "", 10);
  const month = MONTHS.indexOf((match[2] ?? "").slice(0, 3).toLowerCase());
  const year = Number.parseInt(match[3] ?? "", 10);
  if (month < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;

  return new Date(Date.UTC(year < 100 ? 2000 + year : year, month, day));
}

export class Target extends Manga18fxSource {}
