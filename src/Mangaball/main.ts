import {
  Body,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  HttpClient,
  ProviderLinkType,
  ReadingMode,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type CoverRequestHandler,
  type Form,
  type Highlight,
  type PageLink,
  type PageLinkResolver,
  type PageRequestHandler,
  type PageSection,
  type PagedSearchResult,
  type Provider,
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

import { HTML_ACCEPT, JSON_ACCEPT, buildClient, buildImageClient } from "./client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSortId,
  toPageSections,
  withQuery,
  type QueryParams,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  API_URL,
  BASE_URL,
  CHAPTER_LANGUAGES_KEY,
  CONTENT_TYPE_BY_ORIGIN,
  COVER_CDN,
  FEATURED_SIZE,
  FilterID,
  LANGUAGE_ALIASES,
  ListID,
  OriginID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PREFERENCE_SECTIONS,
  Period,
  RECOMMEND_SIZE,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  STATUS_BY_NAME,
  SortID,
  TAGS_FIELD,
  TOP_CHAPTERS_FETCH,
  TOP_CHAPTERS_SIZE,
  TOP_CHAPTERS_TIMEOUT,
  TOP_RATED_SIZE,
  type ApiChapter,
  type ApiChapterListing,
  type ApiCover,
  type ApiDetail,
  type ApiGroup,
  type ApiListing,
  type ApiPagination,
  type ApiTag,
  type ApiTitle,
  type ApiTopChapters,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "mangaball",
  name: "Mangaball",
  version: "1.4.1",
  description: "Pulls manga, manhwa and manhua from mangaball.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.SPANISH,
    DefinedLanguages.PORTUGUESE,
    DefinedLanguages.FRENCH,
    DefinedLanguages.CHINESE,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mangaball.com", "mangaball.net"],
};

class MangaballSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    CoverRequestHandler,
    PageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private client: HttpClient | undefined;
  private images: HttpClient | undefined;
  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  private get http(): HttpClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      // The home page's rows resolve together; the API answers a dozen at once in about
      // two seconds, measured, with no errors and no rate limiting.
      requests: 12,
      interval: 1,
      accept: JSON_ACCEPT,
      json: true,
    });
    return this.client;
  }

  // Both image hosts sit behind Cloudflare and serve an <img> on the site's own pages:
  // the referer is what they check. No origin — a browser sends none for an image.
  private get imageHttp(): HttpClient {
    this.images ??= buildImageClient({ referer: `${BASE_URL}/` });
    return this.images;
  }

  getCoverTransport(): HttpClient {
    return this.imageHttp;
  }

  getPageTransport(): HttpClient {
    return this.imageHttp;
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Featured,
        title: "Featured",
        subtitle: "The site's own front-page picks",
        style: SectionStyle.SimpleHero,
        limit: FEATURED_SIZE,
        viewMore: false,
        load: () => this.fixed("/title/featured", { limit: FEATURED_SIZE }),
      },
      {
        id: ListID.Recommended,
        title: "Recommended Titles",
        subtitle: "What the site suggests reading next",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: RECOMMEND_SIZE,
        viewMore: false,
        load: () => this.fixed("/title/recommended", { limit: RECOMMEND_SIZE }),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 18,
        load: (page) => this.latest(page),
      },
      {
        id: ListID.Added,
        title: "Recently Added",
        subtitle: "New to the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.paged("/title/recently-added", page),
      },
      {
        id: ListID.TopRated,
        title: "Top Rated",
        subtitle: "Highest community score",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TOP_RATED_SIZE,
        viewMore: false,
        load: () => this.fixed("/title/top-rating", { limit: TOP_RATED_SIZE }),
      },
      {
        id: ListID.ReadToday,
        title: "Most Read Today",
        subtitle: "The chapters opened most in the last day",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TOP_CHAPTERS_SIZE,
        viewMore: false,
        load: () => this.topChapters(Period.Day),
      },
      {
        id: ListID.ReadWeek,
        title: "Most Read This Week",
        subtitle: "The chapters opened most over the last seven days",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TOP_CHAPTERS_SIZE,
        viewMore: false,
        load: () => this.topChapters(Period.Week),
      },
      {
        id: ListID.ReadMonth,
        title: "Most Read This Month",
        subtitle: "The chapters opened most over the last month",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TOP_CHAPTERS_SIZE,
        viewMore: false,
        load: () => this.topChapters(Period.Month),
      },
      {
        id: ListID.Viewed,
        title: "Most Viewed",
        subtitle: "The whole catalogue ranked by total views",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.Views }),
      },
      {
        id: ListID.Manga,
        title: "Manga Updates",
        subtitle: "Japanese series with a fresh chapter",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.LatestChapters, origin: OriginID.Manga }),
      },
      {
        id: ListID.Manhwa,
        title: "Manhwa Updates",
        subtitle: "Korean series with a fresh chapter",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.LatestChapters, origin: OriginID.Manhwa }),
      },
      {
        id: ListID.Manhua,
        title: "Manhua Updates",
        subtitle: "Chinese series with a fresh chapter",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.LatestChapters, origin: OriginID.Manhua }),
      },
      {
        id: ListID.Comics,
        title: "Comics Updates",
        subtitle: "English-language series with a fresh chapter",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.LatestChapters, origin: OriginID.Comics }),
      },
      {
        id: ListID.Completed,
        title: "Finished Series",
        subtitle: "Completed runs you can read end to end",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.Views, status: "completed" }),
      },
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, PREFERENCE_SECTIONS);
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: TAGS_FIELD,
      tagsHeader: "Tags",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = this.sections().find((section) => section.id === sectionID);
    if (!spec) return { items: [] };
    const { results } = await spec.load(1);
    return { items: spec.limit === undefined ? results : results.slice(0, spec.limit) };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return list;

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);
    const allowed = request.context?.allowedContentRatings;

    return this.browse({
      page: pageOf(request),
      text: request.query?.trim() ?? "",
      sort: resolveSortId(SORT_OPTIONS, request, SortID.LatestChapters),
      ascending: request.sort?.ascending ?? false,
      status: filters.option(FilterID.Status, ANY),
      demographic: filters.option(FilterID.Demographic, ANY),
      origin: filters.option(FilterID.Origin, ANY),
      translated: filters.options(FilterID.Translated),
      tags: tags.included,
      excludeTags: tags.excluded,
      tagMode: filters.option(FilterID.TagMode, "and"),
      // The host's rating policy, when it states one, is applied at the site rather than
      // by discarding rows after the fact.
      ...(allowed && !allowed.includes(ContentRating.EXPLICIT) ? { adultMode: "no_18" } : {}),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const id = titleIdOf(contentId);
    const payload = await this.json<ApiDetail>(`${API_URL}/title/detail/${encodeURIComponent(id)}`);
    const title = payload.data ?? undefined;
    const name = clean(title?.name ?? "");
    if (!title || !name) {
      throw new Error(
        `Manga Ball has no title with the id "${contentId}". It may have been withdrawn.`,
      );
    }

    const tags: Tag[] = (title.tags ?? [])
      .map((tag) => ({ id: tag.id ?? tag._id ?? "", title: clean(tag.name ?? "") }))
      .filter((tag) => tag.id !== "" && tag.title !== "");
    const type =
      CONTENT_TYPE_BY_ORIGIN[(title.originalLanguage ?? "").toLowerCase()] ?? ContentType.MANGA;
    const status = STATUS_BY_NAME[(title.status ?? "").toLowerCase()];
    const year = readString(title.date_published);
    const summary = descriptionOf(title.description);

    const alternatives = uniqueNames(title.alternateName).filter((other) => other !== name);
    const staff: StaffItem[] = uniqueNames(
      (title.authors ?? title.author ?? []).map((person) => person.name ?? ""),
    ).map((person) =>
      additionalInfo.staff.item({ id: person, title: person, subtitle: "Author / Artist" }),
    );
    const trackers = trackersFrom(title.links);

    return {
      title: name,
      cover: coverOf(title.image),
      summary: summary || `${name}${year ? ` (${year})` : ""} on Manga Ball.`,
      tags,
      contentType: type,
      contentRating: ratingFor(
        title.is18plus === true,
        tags.map((tag) => tag.title),
      ),
      recommendedPanelMode: panelModeFor(type),
      webUrl: titleUrl(contentId),
      ...(status === undefined ? {} : { status }),
      ...(alternatives.length === 0 ? {} : { additionalTitles: alternatives }),
      ...(Object.keys(trackers).length === 0 ? {} : { trackerInfo: trackers }),
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
    const titleId = titleIdOf(contentId);
    const response = await this.http.post(
      `${API_URL}/chapter/chapter-listing-by-title-id`,
      Body.json({ title_id: titleId }),
    );
    const payload = await response.json<ApiChapterListing>();
    const entries = payload.data ?? [];

    const wanted = new Set(await this.chapterLanguages());
    const listed = entries.filter((entry) => {
      const code = (entry.lang ?? "").toLowerCase();
      return (entry.id ?? entry._id) !== undefined && (wanted.size === 0 || wanted.has(code));
    });

    // The listing is newest-first and `index` has to run from the first chapter, so the
    // whole list is reversed once before anything is assigned an index.
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const entry of [...listed].reverse()) {
      const chapterId = entry.id ?? entry._id ?? "";
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);
      const volume = entry.volume ?? 0;
      const provider = providerFrom(entry.group ?? undefined);
      chapters.push({
        chapterId,
        number: chapterNumber(entry, chapters.length + 1),
        index: chapters.length,
        date: parsePublishDate(entry.created_at ?? undefined) ?? new Date(0),
        language: languageOf(entry.lang ?? undefined),
        title: chapterTitle(entry),
        webUrl: chapterUrl(chapterId),
        ...(volume > 0 ? { volume } : {}),
        ...(provider === undefined ? {} : { provider }),
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        entries.length === 0
          ? `Manga Ball listed no chapters for "${contentId}". The series may have been withdrawn.`
          : `Manga Ball has no chapters for "${contentId}" in the languages selected in this source's settings.`,
      );
    }
    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const response = await this.http.get(chapterUrl(chapterId), {
      headers: { accept: HTML_ACCEPT },
    });
    const pages: ChapterPage[] = pagesFrom(await response.text(), chapterId).map((url) => ({
      url,
    }));

    if (pages.length === 0) {
      throw new Error(
        `Manga Ball returned no pages for chapter "${chapterId}" of "${contentId}". The chapter may have been pulled.`,
      );
    }
    return { pages };
  }

  // -- listings ----------------------------------------------------------------

  /** A row the site serves whole, with no page behind it. */
  private async fixed(path: string, params: QueryParams): Promise<PagedSearchResult> {
    const payload = await this.json<ApiListing>(withQuery(`${API_URL}${path}`, params));
    return { results: highlightsFrom(payload.data), isLastPage: true };
  }

  private async paged(
    path: string,
    page: number,
    params: QueryParams = {},
  ): Promise<PagedSearchResult> {
    const payload = await this.json<ApiListing>(
      withQuery(`${API_URL}${path}`, { page, limit: PAGE_SIZE, ...params }),
    );
    const results = highlightsFrom(payload.data);
    return { results, isLastPage: lastPage(payload.pagination ?? undefined, page, results.length) };
  }

  private async latest(page: number): Promise<PagedSearchResult> {
    const languages = await this.chapterLanguages();
    return this.paged("/title/recently-updated", page, {
      chapterLanguage: languages.length === 0 ? undefined : languages.join(","),
    });
  }

  private async topChapters(period: string): Promise<PagedSearchResult> {
    const payload = await this.json<ApiTopChapters>(
      withQuery(`${API_URL}/chapter/top-views`, { period, limit: TOP_CHAPTERS_FETCH }),
      // The month window is aggregated on demand and has taken seventeen seconds cold.
      TOP_CHAPTERS_TIMEOUT,
    );
    const results: Highlight[] = [];
    const seen = new Set<string>();
    for (const entry of payload.data ?? []) {
      if (results.length >= TOP_CHAPTERS_SIZE) break;
      const id = contentIdOf({ id: entry.title_id ?? entry.id, slug: entry.slug });
      const title = clean(entry.name ?? "");
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const chapter = readString(entry.chapter_number);
      results.push({
        id,
        title,
        cover: coverOf(entry.image ?? entry.cover),
        webUrl: titleUrl(id),
        contentRating: ratingFor(entry.is18plus === true, tagNames(entry.tags)),
        ...(chapter === "" ? {} : { subtitle: `Chapter ${chapter}` }),
      });
    }
    return { results, isLastPage: true };
  }

  private browse(query: SearchQuery): Promise<PagedSearchResult> {
    return this.paged("/title/search-advanced", query.page, {
      keyword: query.text || undefined,
      sort: query.sort,
      order: query.ascending ? "asc" : "desc",
      status: chosen(query.status),
      demographic: chosen(query.demographic),
      original_language: chosen(query.origin),
      chapterLanguage: joined(query.translated),
      included_tags: joined(query.tags),
      excluded_tags: joined(query.excludeTags),
      tag_mode: query.tags?.length ? query.tagMode : undefined,
      adult_mode: query.adultMode,
    });
  }

  private async json<T>(url: string, timeoutMs?: number): Promise<T> {
    const response = await this.http.get(url, timeoutMs === undefined ? undefined : { timeoutMs });
    return response.json<T>();
  }

  private async chapterLanguages(): Promise<string[]> {
    const selected = await this.preferences.get(CHAPTER_LANGUAGES_KEY);
    return selected.map((code) => code.toLowerCase());
  }
}

// -- urls and ids ------------------------------------------------------------

/**
 * A content id is `<slug>-<24-hex id>`, the shape the site's URLs had when the source
 * shipped, so a library built then still resolves; a listing without a slug carries the
 * bare id. `titleIdOf` takes the id from either, or from the `<id>-<slug>` form the site's
 * URLs have now.
 */
function contentIdOf(item: { id?: string | undefined; slug?: string | undefined }): string {
  const id = clean(item.id ?? "");
  const slug = clean(item.slug ?? "");
  if (!id) return "";
  return slug ? `${slug}-${id}` : id;
}

function titleIdOf(contentId: string): string {
  return (
    /([0-9a-f]{24})$/i.exec(contentId)?.[1] ??
    /^([0-9a-f]{24})(?:-|$)/i.exec(contentId)?.[1] ??
    contentId
  );
}

/** The site redirects a bare id to its slugged URL, so nothing has to remember the slug. */
function titleUrl(contentId: string): string {
  return `${BASE_URL}/title-detail/${encodeURIComponent(titleIdOf(contentId))}`;
}

function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/chapter-detail/${encodeURIComponent(chapterId)}`;
}

function groupUrl(groupId: string): string {
  return `${BASE_URL}/group-detail/${encodeURIComponent(groupId)}`;
}

function coverOf(image: ApiCover | null | undefined): string {
  const mangadex = clean(image?.cdn_mangadex ?? "");
  if (mangadex.startsWith("http")) return mangadex;
  const path = clean(image?.cover?.path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  return path ? `${COVER_CDN}${path}` : "";
}

// -- query shapes ------------------------------------------------------------

function chosen(value: string | undefined): string | undefined {
  return !value || value === ANY ? undefined : value;
}

function joined(values: readonly string[] | undefined): string | undefined {
  const kept = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return kept.length === 0 ? undefined : kept.join(",");
}

function lastPage(pagination: ApiPagination | undefined, page: number, count: number): boolean {
  const pages = pagination?.total_pages;
  if (typeof pages === "number" && Number.isFinite(pages)) return page >= pages;
  return count < PAGE_SIZE;
}

// -- readers -----------------------------------------------------------------

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function uniqueNames(value: readonly string[] | string | null | undefined): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of list) {
    const name = clean(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function tagNames(tags: readonly ApiTag[] | null | undefined): string[] {
  return (tags ?? []).map((tag) => clean(tag.name ?? "")).filter(Boolean);
}

/** The API's descriptions are Markdown paragraphs; the reader wants prose. */
function descriptionOf(value: string[] | string | null | undefined): string {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return parts
    .map((part) =>
      part
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*[-*_]{3,}\s*$/gm, "")
        .replace(/(\*\*|__|~~|`)/g, "")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function trackersFrom(
  links: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> {
  const trackers: Record<string, string> = {};
  const mal = readString(links?.["myanimelist"]);
  if (/^\d+$/.test(mal)) trackers["mal"] = mal;
  const anilist = readString(links?.["anilist"]);
  if (/^\d+$/.test(anilist)) trackers["anilist"] = anilist;
  return trackers;
}

function highlightsFrom(items: readonly ApiTitle[] | null | undefined): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    const id = contentIdOf({ id: item.id ?? item._id, slug: item.slug });
    const title = clean(item.name ?? "");
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    const subtitle = subtitleFor(item);
    results.push({
      id,
      title,
      cover: coverOf(item.image),
      webUrl: titleUrl(id),
      contentRating: ratingFor(item.is18plus === true, tagNames(item.tags)),
      ...(subtitle === "" ? {} : { subtitle }),
    });
  }

  return results;
}

function subtitleFor(item: ApiTitle): string {
  const chapter = readString(item.latest_chapter) || readString(item.recent_chapters?.[0]?.number);
  const status = clean(item.status ?? "").replace(/_/g, " ");
  return [chapter ? `Chapter ${chapter}` : "", status].filter(Boolean).join(" · ");
}

function ratingFor(adult: boolean, tags: readonly string[]): ContentRating {
  const names = tags.map((tag) => tag.toLowerCase());
  if (adult || names.includes("pornographic") || names.includes("hentai")) {
    return ContentRating.EXPLICIT;
  }
  if (
    names.includes("adult") ||
    names.includes("mature") ||
    names.includes("smut") ||
    names.includes("gore") ||
    names.includes("sexual violence")
  ) {
    return ContentRating.MATURE;
  }
  if (names.includes("ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function panelModeFor(type: ContentType): ReadingMode {
  if (type === ContentType.MANHWA || type === ContentType.MANHUA) return ReadingMode.WEBTOON;
  if (type === ContentType.MANGA) return ReadingMode.PAGED_MANGA;
  return ReadingMode.PAGED_COMIC;
}

function languageOf(code: string | undefined): string {
  const value = (code ?? "").toLowerCase();
  if (!value) return DefinedLanguages.ENGLISH;
  return LANGUAGE_ALIASES[value] ?? value;
}

function providerFrom(group: ApiGroup | undefined): Provider | undefined {
  const id = clean(group?.id ?? group?._id ?? "");
  const name = clean(group?.name ?? "");
  if (!id || !name) return undefined;
  return { id, name, links: [{ url: groupUrl(id), type: ProviderLinkType.WEBSITE }] };
}

function chapterNumber(entry: ApiChapter, fallback: number): number {
  if (typeof entry.number === "number" && Number.isFinite(entry.number)) return entry.number;
  const parsed = /(\d+(?:\.\d+)?)/.exec(readString(entry.number) || readString(entry.name))?.[1];
  return parsed === undefined ? fallback : Number.parseFloat(parsed);
}

/** `name` repeats the number on most chapters and names a special on the rest. */
function chapterTitle(entry: ApiChapter): string {
  const number = readString(entry.number);
  const name = clean(entry.name ?? "");
  const label = number === "" ? "" : `Chapter ${number}`;
  if (name === "" || name === number || /^(chapter|ch\.?)\s*\d/i.test(name)) return label || name;
  return label === "" || number === "0" ? name : `${label} · ${name}`;
}

function parsePublishDate(raw: string | undefined): Date | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw ?? "");
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second] = parts.map(Number) as number[];
  const stamp = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  return Number.isNaN(stamp) ? undefined : new Date(stamp);
}

// -- the chapter page --------------------------------------------------------

/**
 * The reader is a Next.js page: its data arrives as the React flight payload, pushed to
 * `self.__next_f` as JSON string literals, and the page list is the `pages` array inside
 * the chapter object there. There is no page endpoint behind it, so the literals are
 * decoded and the array read out by key.
 */
function flightText(html: string): string {
  const parts: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let match = pattern.exec(html);
  while (match) {
    try {
      const decoded: unknown = JSON.parse(match[1] ?? '""');
      if (typeof decoded === "string") parts.push(decoded);
    } catch {
      // A literal the page itself could not have parsed is not data.
    }
    match = pattern.exec(html);
  }
  return parts.join("");
}

function pagesFrom(html: string, chapterId: string): string[] {
  const text = flightText(html);
  const from = text.indexOf(`"chapter":{"id":"${chapterId}"`);
  const match = /"pages":\[((?:"[^"]*",?)*)\]/.exec(from < 0 ? text : text.slice(from));
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(`[${match[1] ?? ""}]`);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (page): page is string => typeof page === "string" && page.startsWith("http"),
    );
  } catch {
    return [];
  }
}

export class Target extends MangaballSource {}
