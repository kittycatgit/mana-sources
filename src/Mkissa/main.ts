import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Form,
  type Highlight,
  type NetworkRequest,
  type NetworkResponse,
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
  type Tag,
} from "@mana-app/types";

import { buildClient, JSON_ACCEPT } from "./client.ts";
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
  API_URL,
  BASE_URL,
  CHAPTER_READ_QUERY,
  CONTENT_QUERY,
  CONTENT_TYPE_BY_FORMAT,
  CountryOrigin,
  FORMAT_BY_COUNTRY,
  FilterID,
  GENRE_OPTIONS,
  IMAGE_BASE_URL,
  LANGUAGE_BY_COUNTRY,
  LIST_QUERY,
  ListID,
  MAX_PAGE,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PREFERENCE_SECTIONS,
  PreferenceID,
  READING_MODE_BY_FORMAT,
  SEARCH_FIELDS,
  SORT_BY,
  SORT_OPTIONS,
  STATUS_BY_LABEL,
  SortID,
  TranslationType,
  type BrowseQuery,
} from "./model.ts";
import { postGraphql } from "./page-fetch.ts";

const info: SourceInfo = {
  id: "mkissa",
  name: "Mkissa",
  version: "1.0.1",
  description: "Reads the manga catalogue behind mkissa.to",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.JAPANESE,
    DefinedLanguages.KOREAN,
    DefinedLanguages.CHINESE,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mkissa.to"],
};

class MkissaSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: API_URL,
      // The API answers "Too many requests, please try again in N seconds" to a burst; a
      // steady couple per second runs indefinitely, and the home page's rows are resolved
      // concurrently by the app.
      requests: 2,
      interval: 1,
      accept: JSON_ACCEPT,
      headers: { origin: BASE_URL, referer: `${BASE_URL}/` },
      json: true,
    });
    return this.client;
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Trending,
        title: "Trending",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.browse({ page, sortBy: SortID.Trending }),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 20,
        load: (page) => this.browse({ page, sortBy: SortID.Latest }),
      },
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sortBy: SortID.Popular }),
      },
      {
        id: ListID.Top,
        title: "Top Rated",
        subtitle: "Highest scored across the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sortBy: SortID.Top }),
      },
      {
        id: ListID.Saved,
        title: "Most Saved",
        subtitle: "On the most reading lists",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sortBy: SortID.Saved }),
      },
      {
        id: ListID.Manhwa,
        title: "Latest Manhwa",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) =>
          this.browse({ page, sortBy: SortID.Latest, countryOrigin: CountryOrigin.Korea }),
      },
      {
        id: ListID.Manhua,
        title: "Latest Manhua",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) =>
          this.browse({ page, sortBy: SortID.Latest, countryOrigin: CountryOrigin.China }),
      },
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, PREFERENCE_SECTIONS);
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Filters combine — every one you set has to match.",
      fields: SEARCH_FIELDS,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Genres,
        title: "Genres",
        options: GENRE_OPTIONS,
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
    const genres = filters.excludable(FilterID.Genres);
    const year = Number.parseInt(filters.option(FilterID.Year), 10);

    return this.browse({
      page: pageOf(request),
      query: request.query?.trim() ?? "",
      sortBy: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      countryOrigin: filters.option(FilterID.Country, CountryOrigin.All),
      genres: genres.included,
      excludeGenres: genres.excluded,
      ...(Number.isFinite(year) ? { year } : {}),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const manga = await this.manga(contentId);
    const genres = readStrings(manga["genres"]);

    const tags: Tag[] = genres.map((genre) => ({ id: genre, title: genre }));
    const authors = readStrings(manga["authors"]);
    const magazine = readString(manga["magazine"]);

    const format = formatOf(manga).toLowerCase();

    const trackers: Record<string, string> = {};
    const anilist = readString(manga["aniListId"]);
    const mal = readString(manga["malId"]);
    if (anilist) trackers["al"] = anilist;
    if (mal) trackers["mal"] = mal;

    const staff =
      authors.length === 0
        ? []
        : [
            additionalInfo.staff.section({
              id: "authors",
              title: "Authors",
              hasMore: false,
              items: authors.map((name) => additionalInfo.staff.item({ id: name, title: name })),
            }),
          ];

    return {
      title: displayTitle(manga),
      cover: coverUrl(manga),
      summary: summaryOf(manga, magazine),
      tags,
      contentType: CONTENT_TYPE_BY_FORMAT[format] ?? ContentType.MANGA,
      recommendedPanelMode: READING_MODE_BY_FORMAT[format] ?? ReadingMode.PAGED_MANGA,
      contentRating: ratingOf(genres),
      status: statusOf(manga),
      webUrl: contentUrl(contentId),
      ...(Object.keys(trackers).length === 0 ? {} : { trackerInfo: trackers }),
      ...(staff.length === 0 ? {} : { additionalInfo: staff }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const manga = await this.manga(contentId);
    const translation = await this.translation();
    const newestFirst = chapterStrings(manga, translation);

    if (newestFirst.length === 0) {
      throw new Error(
        `Mkissa lists no ${translation === TranslationType.Raw ? "untranslated" : "translated"} chapters for "${displayTitle(manga)}". Switch the release in the source's settings, or the site has none yet.`,
      );
    }

    const language = languageOf(manga, translation);
    // Only the newest chapter carries a date: the catalogue records one `lastChapterDate`
    // per series and the per-chapter dates live behind one request each.
    const newest = readDate(readRecord(manga["lastChapterDate"])[translation]);

    const chapters: Chapter[] = [];
    for (const chapterString of [...newestFirst].reverse()) {
      const isNewest = chapters.length === newestFirst.length - 1;
      chapters.push({
        chapterId: `${translation}:${chapterString}`,
        title: `Chapter ${chapterString}`,
        number: chapterNumber(chapterString, chapters.length + 1),
        index: chapters.length,
        date: (isNewest ? newest : undefined) ?? new Date(0),
        language,
        webUrl: chapterUrl(contentId, chapterString, translation),
      });
    }
    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const { translation, chapterString } = splitChapterId(chapterId);

    const payload = await this.graphql(CHAPTER_READ_QUERY, {
      mangaId: contentId,
      translationType: translation,
      chapterString,
      limit: 20,
    });

    const edges = readArray(readRecord(payload["chaptersForRead"])["edges"]).map(readRecord);
    const source = bestSource(edges);
    if (!source) {
      throw new Error(
        `Mkissa has no readable source for chapter ${chapterString} of "${contentId}". Another scan may carry it — try a neighbouring chapter.`,
      );
    }

    const head = readString(source["pictureUrlHead"]);
    const pages: ChapterPage[] = picturesOf(source).map((url) => ({ url: pageUrl(url, head) }));

    if (pages.length === 0) {
      throw new Error(
        `Mkissa returned no pages for chapter ${chapterString} of "${contentId}" from ${readString(source["sourceName"]) || "its source"}.`,
      );
    }
    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Reader pages answer 403 with an HTML error unless the request carries the site as its
    // referer. Covers serve bare today, and go through the same handler so they keep
    // working if that changes.
    return {
      url: imageURL,
      headers: { origin: BASE_URL, referer: `${BASE_URL}/` },
    };
  }

  private async browse(query: BrowseQuery): Promise<PagedSearchResult> {
    const translation = await this.translation();
    const page = Math.min(pageOf({ page: query.page }), MAX_PAGE);

    const search: Record<string, unknown> = {
      sortBy: SORT_BY[query.sortBy] ?? SORT_BY[SortID.Latest],
      allowAdult: true,
      allowUnknown: true,
    };
    if (query.query) search["query"] = query.query;
    if (query.genres?.length) search["genres"] = [...query.genres];
    if (query.excludeGenres?.length) search["excludeGenres"] = [...query.excludeGenres];
    if (query.year !== undefined) search["year"] = query.year;

    const payload = await this.graphql(LIST_QUERY, {
      search,
      limit: PAGE_SIZE,
      page,
      translationType: translation,
      countryOrigin: query.countryOrigin || CountryOrigin.All,
    });

    const edges = readArray(readRecord(payload["mangas"])["edges"]).map(readRecord);
    const results = edges
      .map((edge) => highlightOf(edge, translation))
      .filter((entry): entry is Highlight => entry !== undefined);

    return { results, isLastPage: page >= MAX_PAGE || results.length < PAGE_SIZE };
  }

  private async manga(contentId: string): Promise<Record<string, unknown>> {
    const payload = await this.graphql(CONTENT_QUERY, { _id: contentId });
    const manga = readRecord(payload["manga"]);
    if (readString(manga["_id"]) === "") {
      throw new Error(`Mkissa has no series with the id "${contentId}".`);
    }
    return manga;
  }

  private async translation(): Promise<string> {
    const stored = await this.preferences.get(PreferenceID.Translation);
    return stored === TranslationType.Raw ? TranslationType.Raw : TranslationType.Sub;
  }

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body = { query, variables };
    // The host serialises `body` itself from the content type, so this stays an object —
    // a string here would reach the API JSON-encoded a second time.
    const direct = envelope(
      await this.http.post(API_URL, {
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    if (!direct.captcha) return dataOf(direct);

    // The API gates some queries behind a Turnstile solve that a plain request cannot
    // answer. Re-issuing it from inside the site's own origin carries the app's cookie jar
    // — including whatever the reader cleared through `cloudflareResolutionURL` — which is
    // the only channel a source has for this.
    const throughPage = envelope(await this.pageRequest(JSON.stringify(body)));
    if (!throughPage.captcha) return dataOf(throughPage);

    throw new CloudflareError(BASE_URL);
  }

  private async pageRequest(body: string): Promise<string> {
    const page = await WebViewPage.create();
    // A script-free document on the site's origin. The home page runs the site's own
    // bundle and its ads, and none of that is needed to issue one request.
    await page.goto(`${BASE_URL}/robots.txt`, { waitUntil: "load" });
    return page.evaluate<string, [string, string]>(postGraphql, API_URL, body);
  }
}

// -- the API's envelope ------------------------------------------------------

type Envelope = { payload: Record<string, unknown>; errors: string[]; captcha: boolean };

function envelope(response: NetworkResponse | string): Envelope {
  const raw = typeof response === "string" ? response : response.data;
  const body = readRecord(safeParse(raw));
  const errors = readArray(body["errors"])
    .map((entry) => readString(readRecord(entry)["message"]))
    .filter(Boolean);

  return {
    payload: readRecord(body["data"]),
    errors,
    captcha: errors.some((message) => message.includes("NEED_CAPTCHA")),
  };
}

function dataOf(result: Envelope): Record<string, unknown> {
  // A GraphQL reply carries errors beside a 200, and a partial `data` is still worth
  // reading — but a reply with nothing in `data` and something in `errors` is a failure
  // that would otherwise surface as an empty shelf.
  if (Object.keys(result.payload).length === 0 && result.errors.length > 0) {
    throw new Error(`Mkissa rejected the request: ${result.errors.join("; ")}`);
  }
  return result.payload;
}

// -- site shapes -------------------------------------------------------------

function contentUrl(contentId: string): string {
  return `${BASE_URL}/manga/${encodeURIComponent(contentId)}`;
}

function chapterUrl(contentId: string, chapterString: string, translation: string): string {
  return `${contentUrl(contentId)}/chapter-${encodeURIComponent(chapterString)}-${translation}`;
}

function splitChapterId(chapterId: string): { translation: string; chapterString: string } {
  const at = chapterId.indexOf(":");
  if (at < 0) return { translation: TranslationType.Sub, chapterString: chapterId };
  const translation = chapterId.slice(0, at);
  return {
    translation: translation === TranslationType.Raw ? TranslationType.Raw : TranslationType.Sub,
    chapterString: chapterId.slice(at + 1),
  };
}

/** Bare paths from the API are relative to the media host, with `mcovers/` often implied. */
const IMPLIED_COVER_PATH = /^(?:c|ce|w|m|ms|a|ep|cp)_tbs\//;

function mediaUrl(path: string, host = IMAGE_BASE_URL): string {
  const clean = path.trim();
  if (clean === "") return "";
  if (clean.startsWith("//")) return `https:${clean}`;
  if (/^https?:\/\//i.test(clean)) return clean;
  const rooted = IMPLIED_COVER_PATH.test(clean) ? `mcovers/${clean}` : clean;
  return `${host.replace(/\/$/, "")}/${rooted.replace(/^\//, "")}`;
}

function coverUrl(entry: Record<string, unknown>): string {
  // `thumbnail` is the series' nominal cover and 404s on the media host for a fair share of
  // the catalogue — an older file it no longer stores, or an AniList URL it cannot serve.
  // `tbObj.u` is the variant the site's own cards fall back to, and it resolves where
  // `thumbnail` does not.
  const preferred = readString(readRecord(entry["tbObj"])["u"]);
  return mediaUrl(preferred || readString(entry["thumbnail"]));
}

function pageUrl(url: string, head: string): string {
  if (!head) return mediaUrl(url);
  return mediaUrl(url, head.includes("//") ? head : `https://${head}`);
}

function displayTitle(entry: Record<string, unknown>): string {
  return readString(entry["englishName"]) || readString(entry["name"]) || readString(entry["_id"]);
}

function formatOf(entry: Record<string, unknown>): string {
  const declared = readString(entry["type"]);
  if (declared) return declared;
  return FORMAT_BY_COUNTRY[readString(entry["countryOfOrigin"])] ?? "";
}

function chapterCount(entry: Record<string, unknown>, translation: string): number {
  return readNumber(readRecord(entry["availableChapters"])[translation]) ?? 0;
}

function chapterStrings(manga: Record<string, unknown>, translation: string): string[] {
  return readArray(readRecord(manga["availableChaptersDetail"])[translation])
    .map(readString)
    .filter(Boolean);
}

function languageOf(manga: Record<string, unknown>, translation: string): string {
  if (translation !== TranslationType.Raw) return DefinedLanguages.ENGLISH;
  return LANGUAGE_BY_COUNTRY[readString(manga["countryOfOrigin"])] ?? DefinedLanguages.JAPANESE;
}

function statusOf(manga: Record<string, unknown>): PublicationStatus | undefined {
  return STATUS_BY_LABEL[readString(manga["status"]).toLowerCase()];
}

const EXPLICIT_GENRES = new Set(["Hentai", "Smut"]);
const MATURE_GENRES = new Set(["Adult", "Mature", "Doujinshi", "Yaoi", "Yuri", "Loli", "Shota"]);

function ratingOf(genres: readonly string[]): ContentRating {
  if (genres.some((genre) => EXPLICIT_GENRES.has(genre))) return ContentRating.EXPLICIT;
  if (genres.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  if (genres.includes("Ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function summaryOf(manga: Record<string, unknown>, magazine: string): string {
  const description = decodeEntities(stripMarkup(readString(manga["description"])));
  const native = readString(manga["nativeName"]);
  const year = readNumber(readRecord(manga["airedStart"])["year"]);

  const facts = [
    native && native !== displayTitle(manga) ? native : "",
    year === undefined ? "" : `Began ${year}`,
    magazine,
  ].filter(Boolean);

  if (description === "") {
    return facts.length === 0 ? "" : `${facts.join(" · ")}.`;
  }
  return facts.length === 0 ? description : `${description}\n\n${facts.join(" · ")}`;
}

function highlightOf(entry: Record<string, unknown>, translation: string): Highlight | undefined {
  const id = readString(entry["_id"]);
  if (!id) return undefined;

  const count = chapterCount(entry, translation);
  const score = readNumber(entry["score"]);
  const subtitle = [
    formatOf(entry),
    count === 0 ? "" : count === 1 ? "1 chapter" : `${count} chapters`,
    score === undefined ? "" : `★ ${score.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id,
    title: displayTitle(entry),
    cover: coverUrl(entry),
    contentRating: ratingOf(readStrings(entry["genres"])),
    webUrl: contentUrl(id),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

/**
 * The site aggregates scans, so one chapter arrives as several rows — but only this query
 * knows about them, and it costs a request per chapter, so the chapter list cannot report
 * them as versions. Pick the way the site's own reader does: skip the placeholder sources,
 * prefer the site's own storage (whose paths resolve on the media host), then the highest
 * priority row that actually carries pictures.
 */
function bestSource(
  edges: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const usable = edges.filter((edge) => {
    const name = readString(edge["sourceName"]);
    return picturesOf(edge).length > 0 && name !== "unkonw" && !name.startsWith("Wp-");
  });
  if (usable.length === 0) return undefined;

  const ranked = [...usable].sort(
    (a, b) => (readNumber(b["priority"]) ?? 0) - (readNumber(a["priority"]) ?? 0),
  );
  return ranked.find((edge) => readString(edge["streamerId"]) === "allanime") ?? ranked[0];
}

function picturesOf(edge: Record<string, unknown>): string[] {
  return readArray(edge["pictureUrls"])
    .map((entry) => {
      const picture = readRecord(entry);
      return readString(picture["url"]) || readString(picture["u"]);
    })
    .filter(Boolean);
}

function chapterNumber(chapterString: string, fallback: number): number {
  const parsed = Number.parseFloat(chapterString);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The API's dates are a plain record with a **0-based** month, as `Date` itself uses. */
function readDate(value: unknown): Date | undefined {
  const parts = readRecord(value);
  const year = readNumber(parts["year"]);
  if (year === undefined || year < 1970) return undefined;
  const date = new Date(
    Date.UTC(
      year,
      readNumber(parts["month"]) ?? 0,
      readNumber(parts["date"]) ?? 1,
      readNumber(parts["hour"]) ?? 0,
      readNumber(parts["minute"]) ?? 0,
      readNumber(parts["second"]) ?? 0,
    ),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
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

function readStrings(value: unknown): string[] {
  return readArray(value).map(readString).filter(Boolean);
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

function stripMarkup(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class Target extends MkissaSource {}
