import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  ProviderLinkType,
  PublicationStatus,
  ReadingMode,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Cookie,
  type Form,
  type Highlight,
  type PageLink,
  type PageLinkResolver,
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
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { HTML_ACCEPT, JSON_ACCEPT, buildClient } from "./client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  encodeForm,
  listResults,
  pageOf,
  resolveSection,
  resolveSortId,
  toPageSections,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  BASE_URL,
  CHAPTERS_API,
  CHAPTER_LANGUAGES_KEY,
  CHAPTER_READS_SIZE,
  CHAPTER_READS_TIMEOUT,
  CONTENT_TYPE_BY_FLAG,
  FEATURED_SIZE,
  FilterID,
  LANGUAGE_ALIASES,
  LISTING_API,
  ListID,
  ListingType,
  OriginID,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PREFERENCE_SECTIONS,
  RECOMMEND_SIZE,
  SEARCH_API,
  SEARCH_FIELDS,
  SORT_FIELD,
  SORT_OPTIONS,
  STATUS_BY_NAME,
  SortID,
  TAGS_FIELD,
  TRENDING_SIZE,
  Window,
  type ApiChapterListing,
  type ApiGroup,
  type ApiSearchResponse,
  type ApiTitle,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "mangaball",
  name: "Mangaball",
  version: "1.3.3",
  description: "Pulls manga, manhwa and manhua from mangaball.net",
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
  owningLinks: ["mangaball.net"],
};

type Session = { token: string; cookie?: Cookie };

class MangaballSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private session: Session | undefined;
  private pending: Promise<Session> | undefined;
  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

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
        id: ListID.Featured,
        title: "Featured",
        subtitle: "The titles readers opened most this week",
        style: SectionStyle.SimpleHero,
        limit: FEATURED_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Featured, FEATURED_SIZE),
      },
      {
        id: ListID.Recommended,
        title: "Recommended Titles",
        subtitle: "The site's own picks, newest chapter first",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: RECOMMEND_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Recommend, RECOMMEND_SIZE),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.LatestChapters }),
      },
      {
        id: ListID.Added,
        title: "Recently Added",
        subtitle: "New to the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.RecentlyAdded }),
      },
      {
        id: ListID.ReadToday,
        title: "Most Read Today",
        subtitle: "Whose chapters were opened most in the last day",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: CHAPTER_READS_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.ChapterReads, CHAPTER_READS_SIZE, Window.Day),
      },
      {
        id: ListID.ReadWeek,
        title: "Most Read This Week",
        subtitle: "Whose chapters were opened most over the last seven days",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: CHAPTER_READS_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.ChapterReads, CHAPTER_READS_SIZE, Window.Week),
      },
      {
        id: ListID.ReadMonth,
        title: "Most Read This Month",
        subtitle: "Whose chapters were opened most over the last month",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: CHAPTER_READS_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.ChapterReads, CHAPTER_READS_SIZE, Window.Month),
      },
      {
        id: ListID.ReadYear,
        title: "Most Read This Year",
        subtitle: "Whose chapters were opened most over the last year",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: CHAPTER_READS_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.ChapterReads, CHAPTER_READS_SIZE, Window.Year),
      },
      {
        id: ListID.ViewedToday,
        title: "Most Viewed Today",
        subtitle: "The titles readers opened most in the last day",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TRENDING_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Reads, TRENDING_SIZE, Window.Day),
      },
      {
        id: ListID.ViewedMonth,
        title: "Most Viewed This Month",
        subtitle: "The titles readers opened most over the last month",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TRENDING_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Reads, TRENDING_SIZE, Window.Month),
      },
      {
        id: ListID.ViewedYear,
        title: "Most Viewed This Year",
        subtitle: "The titles readers opened most over the last year",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TRENDING_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Reads, TRENDING_SIZE, Window.Year),
      },
      {
        id: ListID.Viewed,
        title: "Most Viewed of All Time",
        // The site heads this row "Popular This Season"; the query behind it is the whole
        // catalogue by total views, so it is named for what it returns.
        subtitle: "The whole catalogue ranked by total views",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: TRENDING_SIZE,
        viewMore: false,
        load: () => this.listing(ListingType.Popular, TRENDING_SIZE),
      },
      {
        id: ListID.MangaUpdates,
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
        id: ListID.Manga,
        title: "Most Viewed Manga",
        subtitle: "Japanese series by total views",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 18,
        load: (page) => this.browse({ page, sort: SortID.Views, origin: OriginID.Manga }),
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
    return resolveSection(this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return list;

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);

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
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.page(titleUrl(contentId));

    const title = text($("#comicDetail h6").first());
    if (!title) {
      throw new Error(
        `Manga Ball returned no title page for "${contentId}". The id may be wrong or the series withdrawn.`,
      );
    }

    const tags: Tag[] = $("[data-tag-id]")
      .toArray()
      .map((node) => ({ id: $(node).attr("data-tag-id") ?? "", title: text($(node)) }))
      .filter((tag) => tag.id !== "" && tag.title !== "");

    const authors = $("[data-person-id]")
      .toArray()
      .map((node) => text($(node)))
      .filter(Boolean);

    const alternatives = splitAlternates($(".alternate-name-container").first().html() ?? "");
    const summary = $("#descriptionContent .description-text p")
      .toArray()
      .map((node) => text($(node)))
      .filter(Boolean)
      .join("\n\n");

    const year = text(
      $("#comicDetail span.badge")
        .filter((_, node) => text($(node)).startsWith("Published"))
        .first()
        .find("b"),
    );
    const flag = flagCode($("img[src*='/storage/flags/']").first().attr("src"));
    const type = CONTENT_TYPE_BY_FLAG[flag] ?? ContentType.MANGA;
    const badge = $(".badge-status").first();
    const status = statusFrom(badge.attr("class"), text(badge));

    const staff: StaffItem[] = authors.map((name) =>
      additionalInfo.staff.item({ id: name, title: name, subtitle: "Author / Artist" }),
    );

    return {
      title,
      cover: absolute($('meta[property="og:image"]').attr("content") ?? ""),
      summary: summary || `${title}${year ? ` (${year})` : ""} on Manga Ball.`,
      tags,
      contentType: type,
      contentRating: ratingFor(
        false,
        tags.map((tag) => tag.title),
      ),
      recommendedPanelMode: panelModeFor(type),
      webUrl: titleUrl(contentId),
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
    const titleId = titleIdOf(contentId);
    const payload = await this.api<ApiChapterListing>(
      CHAPTERS_API,
      encodeForm({ title_id: titleId, userSettingsEnabled: false }),
    );

    const wanted = new Set(await this.chapterLanguages());
    const entries = payload.ALL_CHAPTERS ?? [];

    // The listing is newest-first and `index` has to run from the first chapter, so every
    // translation is collected in site order and the whole flattened list reversed once.
    const flattened: Omit<Chapter, "index">[] = [];
    for (const entry of entries) {
      const translations = (entry.translations ?? []).filter((translation) => {
        const code = (translation.language ?? "").toLowerCase();
        return translation.id !== undefined && (wanted.size === 0 || wanted.has(code));
      });

      for (const translation of translations) {
        const chapterId = translation.id ?? "";
        const volume = translation.volume ?? 0;
        const provider = providerFrom(translation.group);
        flattened.push({
          chapterId,
          number: chapterNumber(entry, entries.length - flattened.length),
          date: parsePublishDate(translation.date) ?? new Date(0),
          language: languageOf(translation.language),
          title: chapterTitle(entry, translation),
          webUrl: chapterUrl(chapterId),
          ...(volume > 0 ? { volume } : {}),
          ...(provider === undefined ? {} : { provider }),
        });
      }
    }

    const chapters: Chapter[] = flattened
      .reverse()
      .map((chapter, index) => ({ ...chapter, index }));

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
    const response = await this.http.get(chapterUrl(chapterId));
    const raw = /const\s+chapterImages\s*=\s*JSON\.parse\(`([\s\S]*?)`\)/.exec(response.data)?.[1];

    const pages: ChapterPage[] = (parseImageList(raw) ?? [])
      .map((page) => absolute(page))
      .filter(Boolean)
      .map((url) => ({ url }));

    if (pages.length === 0) {
      throw new Error(
        `Manga Ball returned no pages for chapter "${chapterId}" of "${contentId}". The chapter may have been pulled.`,
      );
    }
    return { pages };
  }

  /**
   * The home page's own rows. `search_time` is only read by the windowed types and is left
   * off everything else; no reply carries a `pagination` block, so each is one fixed page.
   */
  private async listing(type: string, limit: number, time?: string): Promise<PagedSearchResult> {
    const payload = await this.api<ApiSearchResponse>(
      LISTING_API,
      encodeForm({ search_type: type, search_limit: limit, search_time: time }),
      type === ListingType.ChapterReads ? CHAPTER_READS_TIMEOUT : undefined,
    );
    // `getRecentChapterRead` answers with the same `updated_at` on every row — a stats-table
    // stamp rather than the title's — which would put "updated 10mo ago" under a title the
    // next row over correctly reports as updated 16 hours ago.
    return {
      results: highlightsFrom(payload.data, type !== ListingType.ChapterReads),
      isLastPage: true,
    };
  }

  private async browse(query: SearchQuery): Promise<PagedSearchResult> {
    const payload = await this.api<ApiSearchResponse>(SEARCH_API, searchBody(query));
    const results = highlightsFrom(payload.data);

    const pagination = payload.pagination ?? {};
    const current = pagination.current_page ?? query.page;
    const last = pagination.last_page ?? current;
    return { results, isLastPage: results.length === 0 || current >= last };
  }

  private async chapterLanguages(): Promise<string[]> {
    const selected = await this.preferences.get(CHAPTER_LANGUAGES_KEY);
    return selected.map((code) => code.toLowerCase());
  }

  /**
   * The API rejects a request whose CSRF token no longer matches its session with a 403,
   * which `client.ts` cannot tell apart from a Cloudflare block. A cached session that
   * fails is therefore discarded and the call retried once against a fresh one; a session
   * minted for this very call is not retried, because nothing about it is stale.
   */
  private async api<T>(url: string, body: string, timeout?: number): Promise<T> {
    const cached = this.session !== undefined;
    try {
      return await this.post<T>(url, body, timeout);
    } catch (error) {
      if (!cached) throw error;
      this.invalidate();
      return await this.post<T>(url, body, timeout);
    }
  }

  private async post<T>(url: string, body: string, timeout?: number): Promise<T> {
    const session = await this.credentials();
    const response = await this.http.post(url, {
      headers: {
        accept: JSON_ACCEPT,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-csrf-token": session.token,
        "x-requested-with": "XMLHttpRequest",
      },
      ...(session.cookie === undefined ? {} : { cookies: [session.cookie] }),
      ...(timeout === undefined ? {} : { timeout }),
      body,
    });

    let payload: unknown;
    try {
      payload = JSON.parse(response.data);
    } catch {
      throw new Error(`Manga Ball answered ${url} with something that was not JSON.`);
    }

    const envelope = payload as { code?: number; message?: string };
    if (envelope.code !== undefined && envelope.code !== 200) {
      throw new Error(`Manga Ball refused ${url}: ${envelope.message ?? `code ${envelope.code}`}.`);
    }
    return payload as T;
  }

  /**
   * Every API route needs the `csrf-token` meta from a rendered page and the `PHPSESSID`
   * it was minted against: the token alone is a 403, and so is the token paired with a
   * different session's cookie. The token is read once and reused for the life of the
   * source instance.
   *
   * The in-flight request is held rather than the result: a home page carries eighteen rows
   * that resolve together, and without this each one saw an empty `session` and bootstrapped
   * for itself — eighteen fetches of a 300 KB page for one token.
   */
  private async credentials(): Promise<Session> {
    if (this.session) return this.session;

    this.pending ??= this.bootstrap().catch((error: unknown) => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }

  /**
   * Only the token has to come out of the page. Where the client keeps a cookie jar the
   * home page fetch already arrives carrying `PHPSESSID`, so PHP does not re-issue it and
   * there is no `Set-Cookie` to read — but the same jar puts that cookie on the API call,
   * which is the session the token belongs to. Requiring a cookie here failed every row
   * the moment the app had loaded the home page once.
   *
   * A cookie is still attached when the reply offers one, because a jar is not guaranteed.
   * Only the freshly offered one: it is the only cookie certain to pair with this token,
   * and an explicit cookie would override whatever the jar holds.
   */
  private async bootstrap(): Promise<Session> {
    const response = await this.http.get(`${BASE_URL}/`);
    const token = /name="csrf-token"\s+content="([^"]+)"/.exec(response.data)?.[1] ?? "";
    if (!token) {
      throw new Error(
        "Manga Ball served no CSRF token. Its home page has to load before any of its API routes will answer.",
      );
    }

    const value = sessionCookie(response.headers);
    this.session = { token, ...(value ? { cookie: { name: "PHPSESSID", value } } : {}) };
    return this.session;
  }

  /** Drops the cached session and any settled bootstrap, so the next call mints a fresh one. */
  private invalidate(): void {
    this.session = undefined;
    this.pending = undefined;
  }

  private async page(url: string): Promise<CheerioAPI> {
    const response = await this.http.get(url);
    if (!response.data) {
      throw new Error(`Manga Ball returned an empty page for ${url}.`);
    }
    return load(response.data);
  }
}

// -- parsing -----------------------------------------------------------------

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absolute(raw: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (!value) return "";
  // Listings hand back `http://mangaball.net/...` while every page is served over TLS.
  if (/^http:\/\/mangaball\.net/i.test(value)) return value.replace(/^http:/i, "https:");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function titleUrl(contentId: string): string {
  return `${BASE_URL}/title-detail/${encodeURIComponent(contentId)}/`;
}

function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/chapter-detail/${encodeURIComponent(chapterId)}/`;
}

function groupUrl(groupId: string): string {
  return `${BASE_URL}/group/${encodeURIComponent(groupId)}`;
}

/**
 * Manga Ball aggregates, so one chapter number arrives once per language *per group* — a
 * busy title carries twenty-odd groups and the same English chapter from five of them.
 * Reporting the group is what lets the app show those as versions of one chapter and keep
 * a reader on the group they started with; deciding between them is the app's to make.
 *
 * The only link the site offers for a group is its own page, which is server-rendered for
 * every id the listing hands out. A group's external site, where it has one, is on that
 * page rather than in this reply and is not worth a 367 KB fetch per group per listing —
 * see `recon/mangaball.md`.
 */
function providerFrom(group: ApiGroup | undefined): Provider | undefined {
  const id = clean(group?._id ?? "");
  const name = clean(group?.name ?? "");
  if (!id || !name) return undefined;
  return { id, name, links: [{ url: groupUrl(id), type: ProviderLinkType.WEBSITE }] };
}

/**
 * A title is only reachable at `/title-detail/<slug>-<id>/` — the id alone redirects — so
 * the whole slug is the content id and the record id is cut back out of its tail for the
 * chapter API.
 */
function contentIdOf(url: string | undefined): string {
  return /\/title-detail\/([^/?#]+)/.exec(url ?? "")?.[1] ?? "";
}

function titleIdOf(contentId: string): string {
  return /([0-9a-f]{24})$/i.exec(contentId)?.[1] ?? contentId;
}

function sessionCookie(headers: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue;
    const raw = Array.isArray(value) ? value.join("; ") : String(value);
    const found = /PHPSESSID=([^;,\s]+)/.exec(raw)?.[1];
    if (found) return found;
  }
  return "";
}

function searchBody(query: SearchQuery): string {
  const body = encodeForm({
    search_input: query.text ?? "",
    "filters[page]": query.page,
    "filters[sort]": sortValue(query),
    "filters[publicationStatus]": query.status ?? ANY,
    "filters[demographic]": query.demographic ?? ANY,
    "filters[originalLanguages]": query.origin ?? ANY,
    "filters[tag_included_mode]": query.tagMode ?? "and",
  });

  // Three of the facets are PHP array parameters, which repeat rather than taking a
  // delimited value and so cannot be expressed as keys of one object.
  const repeated = [
    ...(query.translated ?? []).map((value) => pair("filters[translatedLanguage][]", value)),
    ...(query.tags ?? []).map((value) => pair("filters[tag_included_ids][]", value)),
    ...(query.excludeTags ?? []).map((value) => pair("filters[tag_excluded_ids][]", value)),
  ];
  return repeated.length === 0 ? body : `${body}&${repeated.join("&")}`;
}

function pair(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/** The site bakes the direction into the sort value: `views_desc`, `name_asc`, and so on. */
function sortValue(query: SearchQuery): string {
  const field =
    SORT_FIELD[query.sort ?? SortID.LatestChapters] ?? SORT_FIELD[SortID.LatestChapters];
  return `${field}_${query.ascending ? "asc" : "desc"}`;
}

function highlightsFrom(items: ApiTitle[] | undefined, updated = true): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    const id = contentIdOf(item.url);
    const title = clean(item.name ?? "");
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    const tags = labelsFrom(item.tags);
    const subtitle = subtitleFor(item, updated);
    results.push({
      id,
      title,
      cover: absolute(item.cover ?? ""),
      webUrl: titleUrl(id),
      contentRating: ratingFor(item.isAdult === true, tags),
      ...(subtitle === "" ? {} : { subtitle }),
    });
  }

  return results;
}

/**
 * `tags`, `authors` and `status` arrive as rendered HTML fragments rather than values. The
 * shapes are fixed and only the label is wanted, so they are read with a regex instead of
 * loading cheerio once per tile.
 */
function labelsFrom(html: string | undefined): string[] {
  const labels: string[] = [];
  const pattern = /<span[^>]*data-tag-id="[^"]*"[^>]*>([^<]*)<\/span>/g;
  let match = pattern.exec(html ?? "");
  while (match) {
    const label = clean(match[1] ?? "");
    if (label) labels.push(label);
    match = pattern.exec(html ?? "");
  }
  return labels;
}

/**
 * `updated_at` is "5m ago" on every listing route but a raw `2026-08-17 09:30:53` on
 * `getFeatured`, which reads as a stray database field beside the other rows. The absolute
 * form is cut back to its date so the whole home page carries the same kind of subtitle.
 */
function subtitleFor(item: ApiTitle, updated: boolean): string {
  const status = clean(stripTags(item.status ?? ""));
  const raw = updated ? clean(item.updated_at ?? "") : "";
  const stamp = /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? raw;
  return [status, stamp ? `updated ${stamp}` : ""].filter(Boolean).join(" · ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/**
 * The badge carries the status twice — as a `status-<name>-title` class and as its own
 * text. The class is the stabler of the two because it is not translated.
 */
function statusFrom(className: string | undefined, label: string): PublicationStatus | undefined {
  const fromClass = /status-([a-z_-]+)-title/i.exec(className ?? "")?.[1]?.toLowerCase() ?? "";
  return STATUS_BY_NAME[fromClass] ?? STATUS_BY_NAME[label.toLowerCase()];
}

function flagCode(src: string | undefined): string {
  return /\/flags\/([a-z-]+)\./i.exec(src ?? "")?.[1]?.toLowerCase() ?? "";
}

/** Alternate titles are one run of text per name, separated by a muted slash. */
function splitAlternates(html: string): string[] {
  return html
    .split(/<span[^>]*class="text-muted"[^>]*>\s*\/\s*<\/span>/i)
    .map((part) => clean(stripTags(part)))
    .filter(Boolean);
}

function ratingFor(adult: boolean, tags: readonly string[]): ContentRating {
  const names = tags.map((tag) => tag.toLowerCase());
  if (adult || names.includes("pornographic")) return ContentRating.EXPLICIT;
  if (names.includes("adult") || names.includes("gore") || names.includes("sexual violence")) {
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

function chapterNumber(
  entry: { number?: string; number_float?: number },
  fallback: number,
): number {
  if (typeof entry.number_float === "number" && Number.isFinite(entry.number_float)) {
    return entry.number_float;
  }
  const parsed = /(\d+(?:\.\d+)?)/.exec(entry.number ?? "")?.[1];
  return parsed === undefined ? fallback : Number.parseFloat(parsed);
}

/**
 * One chapter number can carry several translations, each named by whoever uploaded it —
 * sometimes "Chapter 202", sometimes the group's own banner. The number is prefixed when
 * the name does not already carry it.
 *
 * The group is deliberately not appended. It used to be, as the only way to tell two scans
 * of one chapter apart in a flat list; `provider` now carries it as a field, so repeating
 * it here would print the group's name twice in the same row.
 */
function chapterTitle(entry: { number?: string }, translation: { name?: string }): string {
  const number = clean(entry.number ?? "");
  const name = clean(translation.name ?? "");
  const digits = /\d+(?:\.\d+)?/.exec(number)?.[0] ?? "";

  return name === "" || (digits !== "" && name.includes(digits))
    ? name || number
    : [number, name].filter(Boolean).join(" · ");
}

/** `2026-01-10 04:11:41`, read as UTC so the day does not shift with the device timezone. */
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

function parseImageList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((page) => typeof page === "string") : undefined;
  } catch {
    return undefined;
  }
}

export class Target extends MangaballSource {}
