import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
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

import { JSON_ACCEPT, buildClient } from "./client.ts";
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
  API_URL,
  BASE_URL,
  CONTENT_TYPE_BY_SLUG,
  FilterID,
  ListID,
  MAX_RESULT_WINDOW,
  PAGE_SIZE,
  RATING_BY_NAME,
  READING_MODE_BY_SLUG,
  RESERVED_PATHS,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  STATUS_BY_STATE,
  SortID,
  type ApiParams,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "mangak",
  name: "Mangak",
  version: "1.0.0",
  description: "Reads manga, manhwa and manhua from mangak.io",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mangak.io"],
};

class MangakSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private genreOptions: Option[] | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 5,
      interval: 1,
      accept: JSON_ACCEPT,
      json: true,
    });
    return this.client;
  }

  /**
   * Every row is the same `titles/search` call under a different sort, so a row and the
   * listing behind its view-more button cannot disagree. The site's own `titles/home`
   * endpoint carries four of these already assembled, but it takes no page, so anything
   * built on it would stop at its first screen.
   */
  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Trending,
        title: "Trending Today",
        subtitle: "What the site is reading right now",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.browse({ page, sort: SortID.ViewsToday }),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Latest }),
      },
      {
        id: ListID.Added,
        title: "Recently Added",
        subtitle: "New to the catalogue, chapters or not",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Newest }),
      },
      {
        id: ListID.Followed,
        title: "Most Followed",
        subtitle: "What readers keep in their library",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Popular }),
      },
      {
        id: ListID.Week,
        title: "Most Read This Week",
        subtitle: "Seven days of opens, so one big day counts for less",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.ViewsWeek }),
      },
      {
        id: ListID.Rated,
        title: "Highest Rated",
        subtitle: "Ranked by the score readers give them",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Rating }),
      },
      {
        id: ListID.Longest,
        title: "Longest Series",
        subtitle: "Hundreds of chapters in, and still going",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Chapters }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Filters combine — every one you set has to match.",
      fields: SEARCH_FIELDS,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Genres,
        title: "Genres",
        subtitle: "Include the ones you want, exclude the ones you do not",
        options: await this.genres(),
      }),
      tagsHeader: "Genres",
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
    const keyword = request.query?.trim() ?? "";
    const sort = searchSort(request, keyword);

    const result = await this.browse({
      page: pageOf(request),
      ...(keyword === "" ? {} : { keyword }),
      ...(sort === ANY ? {} : { sort }),
      filters: searchFilters(filters),
    });

    if (allowsAdult(request.context)) return result;
    return {
      ...result,
      results: result.results.filter((item) => item.contentRating !== ContentRating.EXPLICIT),
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const title = await this.title(contentId);
    const type = readString(readRecord(title["type"])["slug"]).toLowerCase();

    const tags: Tag[] = [
      ...properties(title["genres"]),
      ...properties(title["formats"]),
      ...properties(title["demographics"]),
    ];

    const staff: StaffItem[] = [
      ...properties(title["authors"]).map((person) => staffItem(person, "Author")),
      ...properties(title["artists"]).map((person) => staffItem(person, "Artist")),
    ];

    const alternatives = properties(title["alt_names"])
      .map((entry) => entry.title)
      .slice(0, 10);

    const summary = paragraphs(readString(title["summary"]));
    const status = STATUS_BY_STATE[readString(title["status"]).toLowerCase()];

    return {
      title: readString(title["name"]) || contentId,
      cover: readString(title["cover"]),
      ...(summary === "" ? {} : { summary }),
      tags,
      contentType: CONTENT_TYPE_BY_SLUG[type] ?? ContentType.COMIC,
      contentRating: RATING_BY_NAME[readString(title["content_rating"])] ?? ContentRating.SAFE,
      recommendedPanelMode: READING_MODE_BY_SLUG[type] ?? ReadingMode.PAGED_COMIC,
      webUrl: contentUrl(contentId),
      ...(status === undefined ? {} : { status }),
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
    const entries = readArray(
      readRecord(await this.json(`/titles/${encodeURIComponent(contentId)}/chapters`))["chapters"],
    ).map(readRecord);

    const chapters: Chapter[] = [];
    // The site lists newest first; the app wants index 0 on the first available chapter.
    for (const entry of [...entries].reverse()) {
      const chapterId = readString(entry["id"]);
      if (chapterId === "") continue;

      const name = readString(entry["name"]);
      const path = readString(entry["url"]);
      chapters.push({
        chapterId,
        // `number` on the API is the chapter's position in the list, not the number
        // printed on it — Semantic Error's "Chapter 110" arrives as number 154.
        number: chapterNumber(name, readNumber(entry["number"]) ?? chapters.length + 1),
        index: chapters.length,
        date: readDate(entry["updated_at"]) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        ...(name === "" ? {} : { title: name }),
        ...(path === "" ? {} : { webUrl: `${BASE_URL}${path}` }),
      });
    }

    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const chapter = readRecord(
      readRecord(
        await this.json(
          `/titles/${encodeURIComponent(contentId)}/chapters/${encodeURIComponent(chapterId)}`,
        ),
      )["chapter"],
    );

    // Not the `/images` route beside this one: it answers 200 with only the first three
    // pages of any chapter, so a 76-page chapter reads as three and nothing looks wrong.
    const pages: ChapterPage[] = readArray(chapter["images"])
      .map(readString)
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(
        `Mangak returned no pages for chapter ${chapterId} of "${contentId}". The release may have been taken down.`,
      );
    }

    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Both CDNs — pages on rx.qvzr*.org, covers on rx.resmk.org — answer 403 with an HTML
    // error page to any request that does not name the site as its referer.
    return { url: imageURL, headers: { origin: BASE_URL, referer: `${BASE_URL}/` } };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = await this.contentIdForUrl(url);
    if (contentId === undefined) return null;

    const title = await this.title(contentId);
    return { content: toHighlight({ ...title, id: contentId }) };
  }

  // -- listings ----------------------------------------------------------------

  private async browse(query: SearchQuery): Promise<PagedSearchResult> {
    // The API refuses an offset past its result window with a 400 that asks for a cursor.
    // The app pages forwards, so the honest answer is that the list ended there.
    const lastPage = Math.floor(MAX_RESULT_WINDOW / PAGE_SIZE);
    if (query.page > lastPage) return { results: [], isLastPage: true };

    const data = readRecord(
      await this.json("/titles/search", {
        ...query.filters,
        ...(query.keyword === undefined ? {} : { q: query.keyword }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
        page: query.page,
        limit: PAGE_SIZE,
      }),
    );

    const results = readArray(data["items"])
      .map(readRecord)
      .map(toHighlight)
      .filter((item) => item.id !== "");

    return {
      results,
      isLastPage:
        readRecord(data["pagination"])["has_next"] !== true ||
        results.length === 0 ||
        query.page >= lastPage,
    };
  }

  private async genres(): Promise<Option[]> {
    this.genreOptions ??= readArray(readRecord(await this.json("/genres"))["items"])
      .map(readRecord)
      .map((genre) => ({ id: readString(genre["slug"]), title: readString(genre["name"]) }))
      .filter((option) => option.id !== "" && option.title !== "");
    return this.genreOptions;
  }

  private async title(contentId: string): Promise<Record<string, unknown>> {
    const id = contentId.trim();
    if (id === "") throw new Error("Mangak was asked for a title with no id.");

    const title = readRecord(
      readRecord(await this.json(`/titles/${encodeURIComponent(id)}`))["title"],
    );
    if (readString(title["name"]) === "") {
      throw new Error(`Mangak has no title "${contentId}". It may have been removed.`);
    }
    return title;
  }

  /**
   * A title is reachable as `/titles/<id>`, `/titles/<id>-<slug>` and as a bare `/<slug>`.
   * Only the last needs asking the site, which answers with the canonical `/titles/` path.
   */
  private async contentIdForUrl(url: string): Promise<string | undefined> {
    const path = url.replace(/^https?:\/\/[^/]*mangak\.io/i, "").replace(/[?#].*$/, "");
    const direct = /^\/titles\/([A-Za-z0-9]+)(?:-|\/|$)/.exec(path);
    if (direct?.[1]) return direct[1];

    const slug = /^\/([A-Za-z0-9][A-Za-z0-9.-]*)\/?$/.exec(path)?.[1];
    if (slug === undefined || RESERVED_PATHS.includes(slug.toLowerCase())) return undefined;

    const resolved = readString(
      readRecord(await this.json(`/titles/by-slug/${encodeURIComponent(slug)}`))["new_url"],
    );
    return /\/titles\/([A-Za-z0-9]+)/.exec(resolved)?.[1];
  }

  private async json(path: string, params?: ApiParams): Promise<unknown> {
    const response = await this.http.get(withQuery(`${API_URL}${path}`, params));
    const envelope = readRecord(safeParse(response.data));
    if (envelope["success"] !== true) {
      throw new Error(
        `Mangak rejected ${path}: ${readString(envelope["message"]) || "no reason given"}`,
      );
    }
    return envelope["data"];
  }
}

// -- readers -----------------------------------------------------------------

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

function readDate(value: unknown): Date | undefined {
  const raw = readString(value);
  if (raw === "") return undefined;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

// -- site shapes -------------------------------------------------------------

function contentUrl(contentId: string): string {
  return `${BASE_URL}/titles/${encodeURIComponent(contentId)}`;
}

/**
 * Every named list the API returns — genres, formats, demographics, authors, artists,
 * alternative titles — is the same `{ name, slug? }` shape.
 */
function properties(value: unknown): { id: string; title: string }[] {
  return readArray(value)
    .map(readRecord)
    .map((entry) => {
      const title = readString(entry["name"]);
      return { id: readString(entry["slug"]) || title, title };
    })
    .filter((entry) => entry.title !== "");
}

function staffItem(person: { id: string; title: string }, role: string): StaffItem {
  return additionalInfo.staff.item({ id: person.id, title: person.title, subtitle: role });
}

function toHighlight(entry: Record<string, unknown>): Highlight {
  const subtitle = highlightSubtitle(entry);
  const badge = highlightBadge(entry);

  return {
    id: readString(entry["id"]),
    title: readString(entry["name"]),
    cover: readString(entry["cover"]),
    // A listing entry carries `is_adult` and no `content_rating`; the title view has the
    // precise value. Erring towards the stricter of the two is what keeps an explicit
    // title out of a listing the host has restricted.
    contentRating: entry["is_adult"] === true ? ContentRating.EXPLICIT : ContentRating.SAFE,
    webUrl: contentUrl(readString(entry["id"])),
    ...(subtitle === "" ? {} : { subtitle }),
    ...(badge === undefined ? {} : { badge: { text: badge } }),
  };
}

function highlightSubtitle(entry: Record<string, unknown>): string {
  const latest = readString(readRecord(readArray(entry["latest_chapters"])[0])["name"]);
  if (latest !== "") return latest;

  const count = readNumber(readRecord(entry["stats"])["chapters_count"]) ?? 0;
  if (count === 1) return "1 chapter";
  return count > 1 ? `${count} chapters` : "";
}

function highlightBadge(entry: Record<string, unknown>): string | undefined {
  if (entry["is_new"] === true) return "New";
  if (entry["is_hot"] === true) return "Hot";
  return undefined;
}

/** Summaries arrive as plain text padded with trailing spaces and triple newlines. */
function paragraphs(summary: string): string {
  return summary
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chapterNumber(title: string, fallback: number): number {
  const match = /(?:chapter|chap|ch|episode|ep|#)\s*\.?\s*(\d+(?:\.\d+)?)/i.exec(title);
  const parsed = readNumber(match?.[1] ?? /(\d+(?:\.\d+)?)\s*$/.exec(title)?.[1]);
  return parsed ?? fallback;
}

/**
 * Omitting `sort` is the API's relevance ranking, and it is the only ordering that makes a
 * keyword search read as one: `q=solo&sort=latest` matches the same 463 titles and opens
 * with whichever of them gained a chapter most recently, none of them named Solo. Without a
 * keyword there is nothing to rank, so the browse listing needs a real sort.
 *
 * `resolveSortId` cannot express this: its fallback loses to whichever option is marked
 * `isDefault`, and Latest Updated has to be that for the browse case.
 */
function searchSort(request: SearchRequest, keyword: string): string {
  const chosen = request.sort?.id ?? "";
  if (SORT_OPTIONS.some((option) => option.id === chosen)) return chosen;
  return keyword === "" ? SortID.Latest : ANY;
}

/**
 * The host's rating policy is absent when it sets none, which means "no restriction"
 * rather than "allow nothing".
 */
function allowsAdult(context: SourceContext | undefined): boolean {
  const allowed = context?.allowedContentRatings;
  if (!allowed) return true;
  return allowed.includes(ContentRating.EXPLICIT);
}

function listParam(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join(",");
}

function chapterBound(filters: FilterReader, id: string): number | undefined {
  const value = filters.number(id);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function searchFilters(filters: FilterReader): ApiParams {
  const genres = filters.excludable(FilterID.Genres);

  return {
    genres: listParam(genres.included),
    exclude: listParam(genres.excluded),
    demographic: listParam(filters.options(FilterID.Demographics)),
    format: listParam(filters.options(FilterID.Formats)),
    status: filters.option(FilterID.Status) || undefined,
    type: filters.option(FilterID.Type) || undefined,
    content_rating: filters.option(FilterID.Rating) || undefined,
    min_ch: chapterBound(filters, FilterID.MinChapters),
    max_ch: chapterBound(filters, FilterID.MaxChapters),
  };
}

export class Target extends MangakSource {}
