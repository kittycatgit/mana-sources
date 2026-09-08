import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SearchMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type LinkItem,
  type NetworkRequest,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchListItem,
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
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSection,
  resolveSortId,
  toPageSections,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  API_URL,
  BASE_URL,
  CHAPTER_PAGE_SIZE,
  CONTENT_TYPE_BY_NAME,
  FAN_PROVIDER,
  FilterID,
  HOT_FILTER,
  LANGUAGE_CODES,
  ListID,
  MAX_CHAPTER_PAGES,
  OFFICIAL_PROVIDER,
  PER_PAGE,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PREFERENCE_SECTIONS,
  PreferenceID,
  RATING_BY_NAME,
  READING_MODE_BY_TYPE,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  STATUS_BY_STATE,
  SortID,
  TYPE_LABELS,
  TrendingDays,
  VRF_STAGES,
  YEAR_CEILING,
  YEAR_FLOOR,
  type ApiParams,
  type FilterGroup,
  type FilterOptions,
  type TitleQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "mangafire",
  name: "Mangafire",
  version: "1.2.2",
  description: "Reads manga, manhwa and manhua from mangafire.to",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.SPANISH,
    DefinedLanguages.FRENCH,
    DefinedLanguages.PORTUGUESE,
    DefinedLanguages.JAPANESE,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mangafire.to"],
};

type ChapterRecord = {
  id: string;
  number: number;
  name: string;
  language: string;
  official: boolean;
  createdAt: number;
};

class MangafireSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  private client: NetworkClient | undefined;
  private options: FilterOptions | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 5,
      interval: 1,
      accept: JSON_ACCEPT,
      // The API answers only to its own front end, and refuses the request outright
      // without the header that front end sends on every call.
      headers: { "x-requested-with": "XMLHttpRequest" },
      json: true,
    });
    return this.client;
  }

  /**
   * Every listing mangafire.to offers without a keyword. The site's home page is one
   * Trending row scoped Day / Week / Month and one Latest Updates row tabbed Hot / New —
   * six queries behind four tabs — and its browse page adds the sorts below. Two of the
   * site's own listings are deliberately absent, because the query behind each is one
   * already on this page rather than a listing of its own: `trending:desc` on /browse is
   * the 7-day view ranking under another name, and `year:asc` sorts the titles carrying
   * no year at all to the front.
   */
  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Trending,
        title: "Trending This Week",
        subtitle: "What the site is reading this week",
        style: SectionStyle.SimpleHero,
        // /top-titles takes a limit and no page: there is no second page to open.
        viewMore: false,
        limit: 8,
        load: () => this.trending(TrendingDays.Week),
      },
      {
        id: ListID.TrendingDay,
        title: "Trending Today",
        subtitle: "The last 24 hours, which is where the site opens",
        style: SectionStyle.DetailedTripleRowPaged,
        viewMore: false,
        limit: 12,
        load: () => this.trending(TrendingDays.Day),
      },
      {
        id: ListID.TrendingMonth,
        title: "Trending This Month",
        subtitle: "The same ranking over a month, where a slow climb still shows",
        style: SectionStyle.DetailedTripleRowPaged,
        viewMore: false,
        limit: 12,
        load: () => this.trending(TrendingDays.Month),
      },
      {
        id: ListID.Hot,
        title: "Hot Updates",
        subtitle: "New chapters from the series the site marks hot",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) =>
          this.browse({ page, sort: SortID.Updated, ascending: false, filters: HOT_FILTER }),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Updated, ascending: false }),
      },
      {
        id: ListID.Viewed,
        title: "Most Viewed This Week",
        subtitle: "The week's most opened titles",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.ViewsWeek, ascending: false }),
      },
      {
        id: ListID.ViewedMonth,
        title: "Most Viewed This Month",
        subtitle: "Thirty days of opens, so one big week counts for less",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.ViewsMonth, ascending: false }),
      },
      {
        id: ListID.ViewedAll,
        title: "Most Viewed of All Time",
        subtitle: "The titles the site has served most since it started",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.ViewsTotal, ascending: false }),
      },
      {
        id: ListID.Followed,
        title: "Most Followed",
        subtitle: "What readers keep in their library, not just what they open",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Follows, ascending: false }),
      },
      {
        id: ListID.Added,
        title: "New Arrivals",
        subtitle: "Titles added to the catalogue most recently",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Added, ascending: false }),
      },
      {
        id: ListID.Rated,
        title: "Highest Rated",
        subtitle: "Ranked by the score readers give them",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Score, ascending: false }),
      },
      {
        id: ListID.Year,
        title: "Newest Series",
        subtitle: "Serialised most recently, by the year of publication",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Year, ascending: false }),
      },
      {
        id: ListID.Alphabetical,
        title: "A to Z",
        subtitle: "The whole catalogue, from the top",
        style: SectionStyle.SimpleTripleRow,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Title, ascending: true }),
      },
      {
        id: ListID.Reversed,
        title: "Z to A",
        subtitle: "And the same catalogue from the other end",
        style: SectionStyle.SimpleTripleRow,
        limit: 12,
        load: (page) => this.browse({ page, sort: SortID.Title, ascending: false }),
      },
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, PREFERENCE_SECTIONS);
  }

  async getSearchForm(): Promise<SearchForm> {
    const options = await this.filterOptions();
    const fields: SearchListItem[] = [
      ...SEARCH_FIELDS,
      SearchMultiPickerSheet({
        id: FilterID.Themes,
        title: "Themes",
        subtitle: "Narrower than a genre — settings, tropes and cast",
        options: toOptions(options.themes),
      }),
      SearchMultiPickerSheet({
        id: FilterID.Demographics,
        title: "Demographic",
        subtitle: "The audience the series was serialised for",
        options: toOptions(options.demographics),
      }),
    ];

    return buildSearchForm({
      header: "Filters",
      footer: "Filters combine — every one you set has to match.",
      fields,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Genres,
        title: "Genres",
        subtitle: "Include the ones you want, exclude the ones you do not",
        options: toOptions(options.genres),
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
    const keyword = (request.query ?? "").trim();
    const requested = resolveSortId(SORT_OPTIONS, request, SortID.Updated);
    // Best Match ranks nothing without a keyword — the API falls back to catalogue order,
    // which reads as an unsorted list rather than a sort the reader chose.
    const sort = requested === SortID.Relevance && keyword === "" ? SortID.Updated : requested;

    return this.browse({
      page: pageOf(request),
      sort,
      ascending: request.sort?.ascending ?? defaultAscending(sort),
      ...(keyword === "" ? {} : { keyword }),
      filters: searchFilters(filters, request.context),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const title = await this.title(contentId);
    const type = readString(title["type"]);
    const groups = [
      ...readGroups(title["genres"]),
      ...readGroups(title["themes"]),
      ...readGroups(title["demographics"]),
    ];

    const tags: Tag[] = groups.map((group) => ({
      id: group.id,
      title: group.name,
      // A genre id is a database key and its name is not a keyword the search understands,
      // so a tapped tag has nowhere to go. The search form's genre picker is the way in.
      isNonInteractive: true,
    }));

    const staff: StaffItem[] = [
      ...readGroups(title["authors"]).map((person) => staffItem(person, "Author")),
      ...readGroups(title["artists"]).map((person) => staffItem(person, "Artist")),
    ];

    const links = trackerLinks(readRecord(title["links"]));
    const sections = [
      staff.length === 0
        ? undefined
        : additionalInfo.staff.section({
            id: "credits",
            title: "Credits",
            hasMore: false,
            items: staff,
          }),
      links.length === 0
        ? undefined
        : additionalInfo.links.section({ id: "elsewhere", title: "Elsewhere", items: links }),
    ].filter((section) => section !== undefined);

    const alternatives = readArray(title["altTitles"]).map(readString).filter(Boolean);
    const trackers = trackerInfo(title);
    const summary = summaryOf(title);

    return {
      title: readString(title["title"]) || contentId,
      cover: posterUrl(title["poster"], "large"),
      ...(summary === "" ? {} : { summary }),
      tags,
      contentType: CONTENT_TYPE_BY_NAME[type] ?? ContentType.COMIC,
      contentRating: RATING_BY_NAME[readString(title["contentRating"])] ?? ContentRating.SAFE,
      status: STATUS_BY_STATE[readString(title["status"])] ?? PublicationStatus.ONGOING,
      recommendedPanelMode: READING_MODE_BY_TYPE[type] ?? ReadingMode.PAGED_COMIC,
      webUrl: absolute(readString(title["url"])),
      ...(alternatives.length === 0 ? {} : { additionalTitles: alternatives.slice(0, 10) }),
      ...(sections.length === 0 ? {} : { additionalInfo: sections }),
      ...(Object.keys(trackers).length === 0 ? {} : { trackerInfo: trackers }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const title = await this.title(contentId);
    const key = readString(title["url"]).replace(/^\/title\//, "");
    const records = await this.chapterRecords(
      contentId,
      readArray(title["languages"]).map(readString),
    );

    // Both versions of a chapter are reported, in the order the site lists them. Which one
    // a reader wants is theirs to pick, and `provider` is what leaves them the choice.
    return records.map((record, index) => ({
      chapterId: record.id,
      number: record.number,
      index,
      date: chapterDate(record.createdAt),
      language: LANGUAGE_CODES[record.language] ?? DefinedLanguages.UNIVERSAL,
      provider: record.official ? OFFICIAL_PROVIDER : FAN_PROVIDER,
      title: chapterTitle(record),
      ...(key === "" ? {} : { webUrl: `${BASE_URL}/title/${key}/chapter/${record.id}` }),
    }));
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const chapter = readRecord(
      (await this.json(`/chapters/${encodeURIComponent(chapterId)}`))["data"],
    );

    const pages: ChapterPage[] = readArray(chapter["pages"])
      .map(readRecord)
      .map((page) => readString(page["url"]))
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(
        `Mangafire returned no pages for chapter ${chapterId} of "${contentId}". The release may have been taken down.`,
      );
    }

    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // The page CDN answers 403 with an HTML error page to anyone whose request does not
    // name the site as its referer. Covers are served without one, but sending it costs
    // nothing and both live under the same handler.
    return { url: imageURL, headers: { origin: BASE_URL, referer: `${BASE_URL}/` } };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = contentIdFromUrl(url);
    if (contentId === undefined) return null;

    const title = await this.title(contentId);
    return {
      content: {
        id: contentId,
        title: readString(title["title"]) || contentId,
        cover: posterUrl(title["poster"], "large"),
        webUrl: absolute(readString(title["url"])),
        contentRating: RATING_BY_NAME[readString(title["contentRating"])] ?? ContentRating.SAFE,
        ...(highlightSubtitle(title) === "" ? {} : { subtitle: highlightSubtitle(title) }),
      },
    };
  }

  // -- listings ----------------------------------------------------------------

  private async trending(days: number): Promise<PagedSearchResult> {
    const envelope = await this.json("/top-titles", { type: "trending", days, limit: PER_PAGE });
    return { results: highlights(envelope["items"]), isLastPage: true };
  }

  private async browse(query: TitleQuery): Promise<PagedSearchResult> {
    const params: ApiParams = {
      ...query.filters,
      order: { [query.sort]: query.ascending ? "asc" : "desc" },
      page: query.page,
      limit: query.limit ?? PER_PAGE,
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    };

    const envelope = await this.json("/titles", params);
    const meta = readRecord(envelope["meta"]);
    const lastPage = readNumber(meta["lastPage"]) ?? query.page;

    return {
      results: highlights(envelope["items"]),
      isLastPage: meta["hasNext"] === false || query.page >= lastPage,
    };
  }

  // -- title data --------------------------------------------------------------

  private async title(contentId: string): Promise<Record<string, unknown>> {
    const id = contentId.trim();
    if (id === "") throw new Error("Mangafire was asked for a title with no id.");

    const title = readRecord((await this.json(`/titles/${encodeURIComponent(id)}`))["data"]);
    if (readString(title["hid"]) === "") {
      throw new Error(`Mangafire has no title "${contentId}". It may have been removed.`);
    }
    return title;
  }

  /**
   * The chapter list is filtered before it is paged, because a popular series carries every
   * language and both translation kinds: One Piece is 7230 chapters unfiltered and 2436 in
   * English alone. Each filter is dropped rather than allowed to empty the list — a title
   * with no official release still has to show its fan translations.
   */
  private async chapterRecords(
    contentId: string,
    available: readonly string[],
  ): Promise<ChapterRecord[]> {
    const language = await this.chapterLanguage(available);
    const translation = await this.preference(PreferenceID.Translation);

    const attempts: ApiParams[] = [];
    if (language !== "" && translation !== ANY) attempts.push({ language, type: translation });
    if (language !== "") attempts.push({ language });
    if (translation !== ANY) attempts.push({ type: translation });
    attempts.push({});

    for (const attempt of attempts) {
      const records = await this.chapterPages(contentId, attempt);
      if (records.length > 0) return records;
    }
    return [];
  }

  private async chapterPages(contentId: string, filters: ApiParams): Promise<ChapterRecord[]> {
    const path = `/titles/${encodeURIComponent(contentId)}/chapters`;
    const records: ChapterRecord[] = [];

    for (let page = 1; page <= MAX_CHAPTER_PAGES; page++) {
      const envelope = await this.json(path, {
        ...filters,
        // Oldest first, so the index the app needs runs the same way the list does.
        sort: "number",
        order: "asc",
        limit: CHAPTER_PAGE_SIZE,
        page,
      });

      for (const entry of readArray(envelope["items"]).map(readRecord)) {
        const record = chapterRecord(entry);
        if (record) records.push(record);
      }

      if (readRecord(envelope["meta"])["hasNext"] !== true) break;
    }

    return records;
  }

  private async chapterLanguage(available: readonly string[]): Promise<string> {
    const preferred = await this.preference(PreferenceID.Language);
    if (available.length === 0) return preferred;
    if (available.includes(preferred)) return preferred;
    // Asking for a language the title has nothing in returns an empty list, so a series
    // published only in Spanish would look chapterless to a reader set to English.
    return available[0] ?? preferred;
  }

  private async preference(key: string): Promise<string> {
    const value = await this.preferences.get(key);
    return typeof value === "string" ? value : "";
  }

  private async filterOptions(): Promise<FilterOptions> {
    if (this.options) return this.options;

    const data = readRecord((await this.json("/filter-options"))["data"]);
    const options: FilterOptions = {
      genres: readGroups(data["genres"]),
      themes: readGroups(data["themes"]),
      demographics: readGroups(data["demographics"]),
    };

    if (options.genres.length === 0) {
      throw new Error("Mangafire returned no genres, so the genre filter would be empty.");
    }

    this.options = options;
    return options;
  }

  private async json(path: string, params?: ApiParams): Promise<Record<string, unknown>> {
    const response = await this.http.get(apiUrl(path, params));
    return readRecord(safeParse(response.data));
  }
}

// -- the vrf signature -------------------------------------------------------

/**
 * The routes the site signs. Everything else under /api answers without a token, and
 * sending one anyway would put a parameter on a request its own front end never sends.
 */
const SIGNED_PATHS: readonly RegExp[] = [
  /^\/titles(?:\/|\?|$)/,
  /^\/chapters\/[^/]+/,
  /^\/volumes\/[^/]+/,
];

type VrfTable = { box: number[]; key: number[]; seed: number };

let tables: VrfTable[] | undefined;

/**
 * Decoded on first use rather than at module scope. A top-level constant built from a
 * function declared further down the file evaluates before that function's own constants
 * do, and the bundle then throws while the build is still reading its intents — which
 * drops the whole source out of `dist/sources.json` with one line of build log.
 */
function vrfTables(): VrfTable[] {
  tables ??= VRF_STAGES.map((stage) => ({
    box: base64Bytes(stage.box),
    key: base64Bytes(stage.key),
    seed: stage.seed,
  }));
  return tables;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(encoded: string): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of encoded) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes;
}

/** base64url without padding, which is the form the site's own token takes. */
function base64Url(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const remaining = bytes.length - i;
    const chunk = (a << 16) | (b << 8) | c;

    out += BASE64_ALPHABET.charAt((chunk >> 18) & 63);
    out += BASE64_ALPHABET.charAt((chunk >> 12) & 63);
    if (remaining > 1) out += BASE64_ALPHABET.charAt((chunk >> 6) & 63);
    if (remaining > 2) out += BASE64_ALPHABET.charAt(chunk & 63);
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

/** The runtime has no TextEncoder, and the canonical string carries non-ASCII keywords. */
function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

/**
 * Three chained substitution passes over the request's own path and query. Each byte is
 * combined with the stage's repeating key and the previous output byte before the stage's
 * 256-entry permutation maps it, so the tail of the token depends on everything before it
 * — which is why a token cannot be reused across requests.
 */
function signature(canonical: string): string {
  let bytes = utf8Bytes(canonical);

  for (const stage of vrfTables()) {
    const out: number[] = [];
    let previous = stage.seed;
    for (let i = 0; i < bytes.length; i++) {
      const keyByte = stage.key[i % stage.key.length] ?? 0;
      previous = stage.box[((bytes[i] ?? 0) ^ keyByte ^ previous) & 0xff] ?? 0;
      out.push(previous);
    }
    bytes = out;
  }

  return base64Url(bytes);
}

type QueryPair = { key: string; value: string };

/**
 * Axios serialises an array as `k[0]=v` and a nested object as `k[field]=v`, and the site
 * signs its parameters in key order. The signed string is the un-encoded form; the request
 * itself is percent-encoded, so the two are built separately from the same pairs.
 */
function flatten(params: ApiParams): QueryPair[] {
  const pairs: QueryPair[] = [];

  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === "") continue;

    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        pairs.push({ key: `${key}[${index}]`, value: String(entry) }),
      );
    } else if (typeof value === "object") {
      for (const [field, entry] of Object.entries(value)) {
        pairs.push({ key: `${key}[${field}]`, value: String(entry) });
      }
    } else {
      pairs.push({ key, value: String(value) });
    }
  }

  return pairs;
}

function apiUrl(path: string, params?: ApiParams): string {
  const pairs = flatten(params ?? {});
  const canonical =
    pairs.length === 0
      ? path
      : `${path}?${pairs.map((pair) => `${pair.key}=${pair.value}`).join("&")}`;

  const query = SIGNED_PATHS.some((pattern) => pattern.test(path))
    ? [...pairs, { key: "vrf", value: signature(canonical) }]
    : pairs;

  const encoded = query
    .map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`)
    .join("&");

  return encoded === "" ? `${API_URL}${path}` : `${API_URL}${path}?${encoded}`;
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

/** Genres, themes, demographics, authors and artists all arrive in this one shape. */
function readGroups(value: unknown): FilterGroup[] {
  return readArray(value)
    .map(readRecord)
    .map((entry) => ({
      id: readString(entry["id"]),
      name: readString(entry["name"]) || readString(entry["title"]),
    }))
    .filter((group) => group.id !== "" && group.name !== "");
}

function toOptions(groups: readonly FilterGroup[]): Option[] {
  return groups.map((group) => ({ id: group.id, title: group.name }));
}

// -- site shapes -------------------------------------------------------------

function absolute(path: string): string {
  if (path === "") return BASE_URL;
  return path.startsWith("http") ? path : `${BASE_URL}${path}`;
}

function posterUrl(value: unknown, size: "medium" | "large"): string {
  const poster = readRecord(value);
  return readString(poster[size]) || readString(poster["medium"]) || readString(poster["small"]);
}

function highlightSubtitle(entry: Record<string, unknown>): string {
  const latest = readNumber(entry["latestChapter"]);
  return [
    TYPE_LABELS[readString(entry["type"])] ?? "",
    latest === undefined || latest <= 0 ? "" : `Ch. ${latest}`,
    readString(entry["chapterUpdatedAt"]),
  ]
    .filter(Boolean)
    .join(" · ");
}

function toHighlight(entry: Record<string, unknown>): Highlight | undefined {
  const id = readString(entry["hid"]);
  const title = readString(entry["title"]);
  if (id === "" || title === "") return undefined;

  const subtitle = highlightSubtitle(entry);
  return {
    id,
    title,
    cover: posterUrl(entry["poster"], "medium"),
    contentRating: RATING_BY_NAME[readString(entry["contentRating"])] ?? ContentRating.SAFE,
    webUrl: absolute(readString(entry["url"])),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

function highlights(value: unknown): Highlight[] {
  return readArray(value)
    .map(readRecord)
    .map(toHighlight)
    .filter((highlight): highlight is Highlight => highlight !== undefined);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * `synopsisHtml` is a marked-up blurb — MangaDex notices, links to official releases and
 * all. Rendered raw it shows the reader tags; stripped to nothing it leaves the title view
 * blank. Line breaks become real ones so a multi-paragraph synopsis still reads as prose.
 */
function summaryOf(title: Record<string, unknown>): string {
  const html = readString(title["synopsisHtml"]);
  if (html === "") return "";

  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function staffItem(person: FilterGroup, role: string): StaffItem {
  return additionalInfo.staff.item({
    id: `${role}:${person.id}`,
    title: person.name,
    subtitle: role,
  });
}

const TRACKER_LINKS: readonly { key: string; title: string }[] = [
  { key: "mal", title: "MyAnimeList" },
  { key: "al", title: "AniList" },
  { key: "md", title: "MangaDex" },
  { key: "mu", title: "MangaUpdates" },
  { key: "mb", title: "MangaBaka" },
];

function trackerLinks(links: Record<string, unknown>): LinkItem[] {
  return TRACKER_LINKS.map(({ key, title }) => ({ title, url: readString(links[key]) }))
    .filter((entry) => entry.url !== "")
    .map((entry) =>
      additionalInfo.links.item({ id: entry.title, title: entry.title, url: entry.url }),
    );
}

function trackerInfo(title: Record<string, unknown>): Record<string, string> {
  const mal = readString(title["malId"]);
  const anilist = readString(title["anilistId"]);
  return {
    ...(mal === "" ? {} : { mal }),
    ...(anilist === "" ? {} : { anilist }),
  };
}

function chapterRecord(entry: Record<string, unknown>): ChapterRecord | undefined {
  const id = readString(entry["id"]);
  const number = readNumber(entry["number"]);
  if (id === "" || number === undefined) return undefined;

  return {
    id,
    number,
    name: readString(entry["name"]).trim(),
    language: readString(entry["language"]),
    official: readString(entry["type"]) === "official",
    createdAt: readNumber(entry["createdAt"]) ?? 0,
  };
}

/** `createdAt` is Unix seconds; the raw value would render as a 1970 date. */
function chapterDate(seconds: number): Date {
  if (seconds <= 0) return new Date(0);
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function chapterTitle(record: ChapterRecord): string {
  return record.name === "" ? `Chapter ${record.number}` : record.name;
}

function contentIdFromUrl(url: string): string | undefined {
  const match = /mangafire\.to\/title\/([^/?#]+)/i.exec(url);
  const key = match?.[1];
  if (key === undefined) return undefined;
  // A title's web key is its id and slug joined by a hyphen, and the id never holds one.
  const id = key.split("-")[0] ?? "";
  return id === "" ? undefined : id;
}

// -- search filters ----------------------------------------------------------

function defaultAscending(sortId: string): boolean {
  return SORT_OPTIONS.find((option) => option.id === sortId)?.defaultAscending ?? false;
}

function year(filters: FilterReader, id: string): number | undefined {
  const value = filters.number(id);
  if (!Number.isFinite(value) || value < YEAR_FLOOR || value > YEAR_CEILING) return undefined;
  return Math.floor(value);
}

/**
 * The host's rating policy narrows what the reader picked rather than replacing it, and an
 * absent policy means no restriction — filtering everything out would empty the source.
 */
function ratingNames(chosen: readonly string[], context: SourceContext | undefined): string[] {
  const allowed = context?.allowedContentRatings;
  if (allowed === undefined) return [...chosen];

  const permitted = Object.keys(RATING_BY_NAME).filter((name) => {
    const rating = RATING_BY_NAME[name];
    return rating !== undefined && allowed.includes(rating);
  });

  if (chosen.length === 0) return permitted;
  return chosen.filter((name) => permitted.includes(name));
}

function searchFilters(filters: FilterReader, context: SourceContext | undefined): ApiParams {
  const genres = filters.excludable(FilterID.Genres);
  const minChapters = filters.number(FilterID.MinChapters);
  const from = year(filters, FilterID.YearFrom);
  const to = year(filters, FilterID.YearTo);
  const ratings = ratingNames(filters.options(FilterID.Ratings), context);

  return {
    ...listParam("types", filters.options(FilterID.Types)),
    ...listParam("statuses", filters.options(FilterID.Statuses)),
    ...listParam("content_rating", ratings),
    ...listParam("languages", filters.options(FilterID.Languages)),
    ...listParam("demographics", filters.options(FilterID.Demographics)),
    ...listParam("theme_ids", filters.options(FilterID.Themes)),
    ...listParam("genres_in", genres.included),
    ...listParam("genres_ex", genres.excluded),
    // The mode only means anything alongside two or more included genres.
    ...(genres.included.length > 1
      ? { genres_mode: filters.option(FilterID.GenreMode, "or") }
      : {}),
    ...(Number.isFinite(minChapters) && minChapters > 0
      ? { min_chap: Math.floor(minChapters) }
      : {}),
    ...(from === undefined ? {} : { year_from: from }),
    ...(to === undefined ? {} : { year_to: to }),
  };
}

function listParam(name: string, values: readonly string[]): ApiParams {
  return values.length === 0 ? {} : { [name]: [...values] };
}

export class Target extends MangafireSource {}
