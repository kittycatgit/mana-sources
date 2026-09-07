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
  type NetworkResponse,
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

import { HTML_ACCEPT, JSON_ACCEPT, buildClient } from "./client.ts";
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
  API_KEY,
  API_KEY_HEADER,
  API_URL,
  BASE_URL,
  CONTENT_TYPE_BY_NAME,
  FilterID,
  LATEST_PAGE_SIZE,
  ListID,
  Procedure,
  RATING_BY_NAME,
  RATING_CEILING,
  READING_MODE_BY_TYPE,
  SEARCH_FIELDS,
  SEARCH_PAGE_SIZE,
  SESSION_COOKIE,
  SORT_OPTIONS,
  STATUS_BY_STATE,
  SortID,
  TRENDING_PAGE_SIZE,
  TYPE_OPTIONS,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "hiperdex",
  name: "Hiperdex",
  version: "1.0.0",
  description: "Pulls manga, manhwa and manhua from hiperdex.com",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["hiperdex.com"],
};

type RatingPolicy = {
  max: string;
  allowed?: readonly ContentRating[];
};

class HiperdexSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private session: string | undefined;
  private key: string | undefined;
  private genreOptions: Option[] | undefined;
  private readonly seriesIds = new Map<string, number>();
  private chapterCache: { contentId: string; records: Record<string, unknown>[] } | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 5,
      interval: 1,
      accept: JSON_ACCEPT,
    });
    return this.client;
  }

  private sections(policy: RatingPolicy): SectionSpec[] {
    return [
      {
        id: ListID.Trending,
        title: "Trending Today",
        subtitle: "What the site is reading right now",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.trending(page, policy),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series with a chapter added today",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 15,
        load: (page) => this.latest(page, policy),
      },
      {
        id: ListID.Popular,
        title: "Most Popular",
        subtitle: "The most-read titles in the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Popular, maxRating: policy.max }, policy),
      },
      {
        id: ListID.TopRated,
        title: "Top Rated",
        subtitle: "Scored highest by readers",
        style: SectionStyle.SimpleTripleRow,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Score, maxRating: policy.max }, policy),
      },
      {
        id: ListID.Added,
        title: "Recently Added",
        subtitle: "New to the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Newest, maxRating: policy.max }, policy),
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
    return toPageSections(this.sections(this.policy(link.context)));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(this.policy(link.context)), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const policy = this.policy(request.context);

    const list = listResults(this.sections(policy), request);
    if (list) return list;

    const filters = new FilterReader(request);
    return this.browse(
      {
        page: pageOf(request),
        query: request.query?.trim() ?? "",
        sort: resolveSortId(SORT_OPTIONS, request, SortID.Relevance),
        type: chosen(filters.option(FilterID.Type)),
        status: chosen(filters.option(FilterID.Status)),
        rating: chosen(filters.option(FilterID.Rating)),
        genres: filters.options(FilterID.Genres),
        maxRating: policy.max,
      },
      policy,
    );
  }

  async getContent(contentId: string): Promise<Content> {
    const series = await this.series(contentId);
    const type = readString(series["type"]);

    const tags: Tag[] = readArray(series["genres"])
      .map(readString)
      .filter(Boolean)
      .map((genre) => ({ id: genre, title: genre }));

    const staff = [
      ...readArray(series["authors"]).map((name) => staffItem(name, "Author")),
      ...readArray(series["artists"]).map((name) => staffItem(name, "Artist")),
    ].filter((item): item is StaffItem => item !== undefined);

    const alternatives = alternativeTitles(series["alternativeTitles"]);
    const status = STATUS_BY_STATE[readString(series["status"]).toLowerCase()];
    const mode = READING_MODE_BY_TYPE[type];

    return {
      title: readString(series["title"]) || contentId,
      cover: readString(series["coverUrl"]),
      summary: readString(series["synopsis"]).trim(),
      tags,
      contentType: CONTENT_TYPE_BY_NAME[type] ?? ContentType.MANGA,
      contentRating: RATING_BY_NAME[readString(series["contentRating"])] ?? ContentRating.EXPLICIT,
      webUrl: contentUrl(contentId),
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
    const records = await this.chapterRecords(contentId);
    const chapters: Chapter[] = [];

    for (const record of records) {
      const chapterId = readString(record["id"]);
      const number = readNumber(record["number"]);
      if (chapterId === "" || number === undefined) continue;

      const volume = readNumber(record["volume"]);
      chapters.push({
        chapterId,
        number,
        index: chapters.length,
        date: readDate(record["createdAt"]) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: readString(record["title"]) || `Chapter ${number}`,
        webUrl: `${contentUrl(contentId)}/${number}`,
        ...(volume === undefined ? {} : { volume }),
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        `Hiperdex lists no published chapters for "${contentId}". The series may have been unpublished or renamed.`,
      );
    }
    return chapters;
  }

  async getChapterData(
    contentId: string,
    chapterId: string,
    chapter?: Chapter,
  ): Promise<ChapterData> {
    const number = chapter?.number ?? (await this.chapterNumber(contentId, chapterId));
    const id = Number.parseInt(chapterId, 10);

    const payload = await this.call(Procedure.Pages, {
      seriesSlug: contentId,
      chapterNumber: number,
      // The endpoint rejects a null chapterId outright but accepts the key being absent,
      // and it is the only thing that separates two chapters sharing a number.
      ...(Number.isFinite(id) ? { chapterId: id } : {}),
    });

    const pages: ChapterPage[] = readArray(payload)
      .map(readRecord)
      .sort((a, b) => (readNumber(a["pageOrder"]) ?? 0) - (readNumber(b["pageOrder"]) ?? 0))
      .map((page) => readString(page["webpUrl"]) || readString(page["avifUrl"]))
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(
        `Hiperdex returned no pages for chapter ${number} of "${contentId}" (chapter ${chapterId}).`,
      );
    }
    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Both CDNs answer 403 with an HTML error page unless the request carries the site as
    // its referer — covers included, not just reader pages.
    return {
      url: imageURL,
      headers: { origin: BASE_URL, referer: `${BASE_URL}/` },
    };
  }

  private async browse(query: SearchQuery, policy: RatingPolicy): Promise<PagedSearchResult> {
    const offset = (pageOf({ page: query.page }) - 1) * SEARCH_PAGE_SIZE;
    const payload = readRecord(
      await this.call(Procedure.Search, {
        q: query.query ?? "",
        sort: query.sort ?? SortID.Relevance,
        filters: {
          ...(query.type === undefined ? {} : { type: query.type }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.rating === undefined ? {} : { contentRating: query.rating }),
          ...(query.genres === undefined || query.genres.length === 0
            ? {}
            : { genres: [...query.genres] }),
        },
        limit: SEARCH_PAGE_SIZE,
        offset,
        maxRating: query.maxRating,
      }),
    );

    const hits = readArray(payload["hits"]).map(readRecord);
    const total = readNumber(payload["totalHits"]) ?? 0;

    return {
      results: this.permitted(hits.map(seriesHighlight), policy),
      isLastPage: offset + hits.length >= total,
      totalResultCount: total,
    };
  }

  private async trending(page: number, policy: RatingPolicy): Promise<PagedSearchResult> {
    const items = readArray(
      await this.call(Procedure.Trending, {
        limit: TRENDING_PAGE_SIZE,
        page,
        maxRating: policy.max,
        period: "day",
      }),
    ).map(readRecord);

    return {
      results: this.permitted(items.map(seriesHighlight), policy),
      isLastPage: items.length < TRENDING_PAGE_SIZE,
    };
  }

  private async latest(page: number, policy: RatingPolicy): Promise<PagedSearchResult> {
    const items = readArray(
      await this.call(Procedure.LatestChapters, {
        limit: LATEST_PAGE_SIZE,
        page,
        maxRating: policy.max,
        seriesType: "all",
        hasSponsoredSlot: false,
      }),
    ).map(readRecord);

    return {
      results: items.map(updateHighlight).filter((item): item is Highlight => item !== undefined),
      isLastPage: items.length < LATEST_PAGE_SIZE,
    };
  }

  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;

    const options = readArray(await this.call(Procedure.Genres))
      .map(readRecord)
      // The search filter matches on the display name, not the slug or the numeric id.
      .map((genre) => ({ id: readString(genre["name"]), title: readString(genre["name"]) }))
      .filter((option) => option.id !== "")
      .sort((a, b) => a.title.localeCompare(b.title));

    this.genreOptions = options;
    return options;
  }

  private async series(contentId: string): Promise<Record<string, unknown>> {
    const series = readRecord(await this.call(Procedure.Series, { slug: contentId }));
    const id = readNumber(series["id"]);
    if (id === undefined) throw new Error(`Hiperdex has no series at "${contentId}".`);

    this.seriesIds.set(contentId, id);
    return series;
  }

  private async seriesId(contentId: string): Promise<number> {
    const cached = this.seriesIds.get(contentId);
    if (cached !== undefined) return cached;

    const series = readRecord(await this.call(Procedure.SeriesSummary, { slug: contentId }));
    const id = readNumber(series["id"]);
    if (id === undefined) throw new Error(`Hiperdex has no series at "${contentId}".`);

    this.seriesIds.set(contentId, id);
    return id;
  }

  private async chapterRecords(contentId: string): Promise<Record<string, unknown>[]> {
    if (this.chapterCache?.contentId === contentId) return this.chapterCache.records;

    const payload = await this.call(Procedure.Chapters, {
      seriesId: await this.seriesId(contentId),
    });
    const records = readArray(payload)
      .map(readRecord)
      // The site's own reader hides everything that is not published; a draft or a
      // scheduled chapter has no pages behind it.
      .filter((record) => readString(record["status"]) === "published")
      .sort((a, b) => (readNumber(a["number"]) ?? 0) - (readNumber(b["number"]) ?? 0));

    this.chapterCache = { contentId, records };
    return records;
  }

  private async chapterNumber(contentId: string, chapterId: string): Promise<number> {
    const records = await this.chapterRecords(contentId);
    const match = records.find((record) => readString(record["id"]) === chapterId);
    const number = readNumber(match?.["number"]);
    if (number === undefined) {
      throw new Error(`Hiperdex has no chapter ${chapterId} on "${contentId}".`);
    }
    return number;
  }

  private policy(context: SourceContext | undefined): RatingPolicy {
    const allowed = context?.allowedContentRatings;
    if (!allowed || allowed.length === 0) return { max: "pornographic" };

    let max = "safe";
    for (const entry of RATING_CEILING) if (allowed.includes(entry.rating)) max = entry.name;
    return { max, allowed };
  }

  private permitted(results: Highlight[], policy: RatingPolicy): Highlight[] {
    const allowed = policy.allowed;
    if (!allowed) return results;
    return results.filter(
      (result) => result.contentRating === undefined || allowed.includes(result.contentRating),
    );
  }

  /**
   * The session cookie the API demands. It is minted only by a document request, so this
   * loads the landing page and reads it back out of `set-cookie`.
   */
  private async sessionToken(refresh: boolean): Promise<string> {
    if (!refresh && this.session !== undefined) return this.session;

    const response = await this.landingPage();
    const match = new RegExp(`${SESSION_COOKIE}=([^;,\\s]+)`).exec(
      headerOf(response.headers, "set-cookie"),
    );

    this.session = match?.[1] ?? "";
    return this.session;
  }

  private landingPage(): Promise<NetworkResponse> {
    return this.http.get(`${BASE_URL}/`, {
      headers: { accept: HTML_ACCEPT },
      validateStatus: (status) => status >= 200 && status < 400,
    });
  }

  private async apiKey(rediscover: boolean): Promise<string> {
    if (!rediscover) return this.key ?? API_KEY;
    this.key = (await this.discoverApiKey()) ?? API_KEY;
    return this.key;
  }

  /** Re-reads the key out of the site's own bundle, for when the copy in `model.ts` ages out. */
  private async discoverApiKey(): Promise<string | undefined> {
    const home = await this.landingPage();
    const asset = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(home.data)?.[1];
    if (asset === undefined) return undefined;

    const bundle = await this.http.get(`${BASE_URL}${asset}`, { headers: { accept: "*/*" } });
    const client = bundle.data.indexOf("/api/trpc");
    if (client === -1) return undefined;

    const region = bundle.data.slice(Math.max(0, client - 800), client);
    const match = /atob\("([A-Za-z0-9+/=]+)"\)\s*\+\s*"([^"]*)"/.exec(region);
    if (match === null) return undefined;

    return `${base64Decode(match[1] ?? "")}${match[2] ?? ""}`;
  }

  private async call(procedure: string, input?: unknown): Promise<unknown> {
    try {
      return await this.attempt(procedure, input, false);
    } catch (error) {
      // A stale API key comes back as the site's own 403, which the shared client cannot
      // tell apart from a Cloudflare block. Re-read the key and try once more before
      // letting the challenge through to the user.
      if (!(error instanceof CloudflareError)) throw error;
      return this.attempt(procedure, input, true);
    }
  }

  private async attempt(
    procedure: string,
    input: unknown,
    rediscoverKey: boolean,
  ): Promise<unknown> {
    const key = await this.apiKey(rediscoverKey);

    let response = await this.send(procedure, input, await this.sessionToken(false), key);
    if (response.status === 401) {
      response = await this.send(procedure, input, await this.sessionToken(true), key);
    }

    if (response.status >= 400) {
      throw new Error(
        `Hiperdex rejected ${procedure} (HTTP ${response.status}): ${apiError(response.data)}`,
      );
    }

    const data = readRecord(readRecord(readRecord(safeParse(response.data))["result"])["data"]);
    if (!("json" in data)) {
      throw new Error(`Hiperdex returned no data for ${procedure}. The API may have changed.`);
    }
    return data["json"];
  }

  private async send(
    procedure: string,
    input: unknown,
    token: string,
    key: string,
  ): Promise<NetworkResponse> {
    const url = withQuery(`${API_URL}/${procedure}`, {
      input: input === undefined ? undefined : JSON.stringify({ json: input }),
    });

    return this.http.get(url, {
      headers: { [API_KEY_HEADER]: key },
      ...(token === "" ? {} : { cookies: [{ name: SESSION_COOKIE, value: token }] }),
      // 401 is the expected answer to a stale session token and is retried, not thrown.
      validateStatus: (status) => status >= 200 && status < 500,
    });
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
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function headerOf(headers: Record<string, unknown>, name: string): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    return Array.isArray(value) ? value.map(readString).join("; ") : readString(value);
  }
  return "";
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** There is no `atob` in the runtime, and the key the site's bundle hides is base64. */
function base64Decode(value: string): string {
  let buffer = 0;
  let bits = 0;
  let decoded = "";

  for (const character of value) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return decoded;
}

function apiError(body: string): string {
  const parsed = readRecord(safeParse(body));
  const error = parsed["error"];
  if (typeof error === "string") return error;
  const message = readString(readRecord(readRecord(error)["json"])["message"]);
  return message || "the server sent no explanation";
}

// -- site shapes -------------------------------------------------------------

function contentUrl(contentId: string): string {
  return `${BASE_URL}/manga/${encodeURIComponent(contentId)}`;
}

/** A picker's "Any" row means "omit the parameter", which is not a value the API takes. */
function chosen(value: string): string | undefined {
  return value === "" || value === ANY ? undefined : value;
}

function titleOf(options: readonly Option[], id: string): string {
  return options.find((option) => option.id === id)?.title ?? "";
}

function formatCount(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K`;
  return String(views);
}

/** Both `search.query` hits and `recommendations.trending` items carry these fields. */
function seriesHighlight(series: Record<string, unknown>): Highlight {
  const slug = readString(series["slug"]);
  const rating = RATING_BY_NAME[readString(series["contentRating"])];
  const score = readNumber(series["score"]) ?? 0;
  const views = readNumber(series["views"]) ?? 0;

  const subtitle = [
    titleOf(TYPE_OPTIONS, readString(series["type"])),
    score > 0 ? `★ ${score.toFixed(1)}` : "",
    views > 0 ? `${formatCount(views)} reads` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: slug,
    title: readString(series["title"]) || slug,
    cover: readString(series["coverUrl"]),
    webUrl: contentUrl(slug),
    ...(rating === undefined ? {} : { contentRating: rating }),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

/** `recommendations.latestChapters` nests the series behind `series*` keys instead. */
function updateHighlight(entry: Record<string, unknown>): Highlight | undefined {
  const slug = readString(entry["seriesSlug"]);
  if (slug === "") return undefined;

  const chapters = readArray(entry["chapters"]).map(readRecord);
  const subtitle = chapters
    .map((chapter) => readNumber(chapter["number"]))
    .filter((number): number is number => number !== undefined)
    .map((number) => `Chapter ${number}`)
    .join(", ");

  return {
    id: slug,
    title: readString(entry["seriesTitle"]) || slug,
    cover: readString(entry["seriesCoverUrl"]),
    webUrl: contentUrl(slug),
    ...(subtitle === "" ? {} : { subtitle }),
    ...(chapters.length <= 1 ? {} : { badge: { count: chapters.length } }),
  };
}

function staffItem(value: unknown, role: string): StaffItem | undefined {
  const name = readString(value).trim();
  if (name === "") return undefined;
  return additionalInfo.staff.item({ id: `${role}:${name}`, title: name, subtitle: role });
}

/**
 * `series.bySlugWithGenres` hands this back JSON-encoded in a string, while `search.query`
 * returns the same field as a real array.
 */
function alternativeTitles(value: unknown): string[] {
  const source = typeof value === "string" ? safeParse(value) : value;
  return readArray(source)
    .map(readString)
    .map((title) => title.trim())
    .filter(Boolean);
}

export class Target extends HiperdexSource {}
