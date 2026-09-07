import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Form,
  type Highlight,
  type LinkItem,
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
  resolveSortId,
  resolveSection,
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  API_URL,
  BASE_URL,
  DEFAULT_IMAGE_SERVERS,
  DEFAULT_THUMB_SERVERS,
  ENGLISH,
  FilterID,
  LANGUAGE_BY_TAG_ID,
  ListID,
  MATCH_ALL_QUERY,
  PER_PAGE,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PREFERENCE_SECTIONS,
  PreferenceID,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  SortID,
  TAG_OPTION_COUNT,
  TagID,
  TagType,
  languageById,
  tagsField,
  type GalleryQuery,
  type LanguageSpec,
  type TaggedQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "nhentai",
  name: "Nhentai",
  version: "1.1.0",
  description: "Reads doujinshi and manga galleries from nhentai.net",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.JAPANESE,
    DefinedLanguages.CHINESE,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: true,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["nhentai.net"],
};

type Servers = { images: readonly string[]; thumbs: readonly string[] };

class NhentaiSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  private client: NetworkClient | undefined;
  private servers: Servers | undefined;
  private tagOptions: Option[] | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      // The API documents per-endpoint anonymous limits as low as 8/min on
      // /galleries/popular, which backs the home hero. Going wider earns a 429.
      requests: 3,
      interval: 1,
      accept: JSON_ACCEPT,
      json: true,
    });
    return this.client;
  }

  /**
   * The chosen language reaches every row, because a home page that ignores the setting is
   * how the setting reads as broken. Only the week row has a language when none is chosen:
   * it is the one that always had one.
   *
   * The hero is the site's own featured five until a language is chosen, at which point
   * there is no featured list to filter and it becomes that language's all-time popular.
   * Not its popular-today, which repeats five of the six galleries the week row opens with.
   *
   * Every language row goes through /galleries/tagged rather than the equivalent
   * `language:` search — the two return the same galleries, and /search answers 429 well
   * before the rest of the API does, which one home page load would otherwise reach.
   */
  private async sections(): Promise<SectionSpec[]> {
    const language = await this.language();
    const week = language ?? ENGLISH;

    return [
      {
        id: ListID.PopularNow,
        title: language ? "Most Popular" : "Popular Right Now",
        subtitle: language
          ? `The site's best-loved ${language.label} galleries`
          : "What the site is featuring today",
        style: SectionStyle.SimpleHero,
        // /galleries/popular returns five galleries and has no page 2 to open; the listing
        // that stands in for it once a language is chosen does paginate.
        viewMore: language !== undefined,
        limit: 6,
        load: (page) =>
          language ? this.inLanguage(language, page, SortID.Popular) : this.popular(),
      },
      {
        id: ListID.Recent,
        title: "Recently Added",
        subtitle: language
          ? `The newest ${language.label} uploads`
          : "The newest uploads, whatever the language",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 12,
        load: (page) =>
          language ? this.inLanguage(language, page, SortID.Date) : this.galleries(page),
      },
      {
        id: ListID.LanguageWeek,
        title: "Popular This Week",
        subtitle: `The week's most read ${week.label} galleries`,
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.inLanguage(week, page, SortID.PopularWeek),
      },
      {
        id: ListID.MangaMonth,
        title: "Manga This Month",
        subtitle: language
          ? `Serialised ${language.label} manga rather than doujinshi`
          : "Serialised manga rather than doujinshi",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) =>
          language
            ? // /galleries/tagged takes one tag, so a category and a language together can
              // only be asked for through search.
              this.searchGalleries({
                page,
                query: `${facet("category", "manga")} ${facet("language", language.id)}`,
                sort: SortID.PopularMonth,
              })
            : this.tagged({ page, tagId: TagID.Manga, sort: SortID.PopularMonth }),
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
      tags: tagsField(await this.tags()),
      tagsHeader: "Tags",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(await this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(await this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    // Every gallery on this site is EXPLICIT, so a host policy that excludes that rating
    // excludes the whole source. An absent policy means no restriction, not "allow none".
    const allowed = request.context?.allowedContentRatings;
    if (allowed !== undefined && !allowed.includes(ContentRating.EXPLICIT)) {
      return { results: [], isLastPage: true };
    }

    const list = listResults(await this.sections(), request);
    if (list) return list;

    const language = await this.language();
    return this.searchGalleries({
      page: pageOf(request),
      query: buildQuery(request.query, new FilterReader(request), language?.id ?? ""),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Date),
    });
  }

  /** The reader's chosen language, or undefined when they have not narrowed the source. */
  private async language(): Promise<LanguageSpec | undefined> {
    return languageById(readString(await this.preferences.get(PreferenceID.Language)));
  }

  async getContent(contentId: string): Promise<Content> {
    const gallery = await this.gallery(contentId);
    const { thumbs } = await this.cdn();
    const titles = readRecord(gallery["title"]);
    const byType = tagsByType(gallery);

    const tags: Tag[] = readArray(gallery["tags"])
      .map(readRecord)
      .map((tag) => readString(tag["name"]))
      .filter(Boolean)
      // A tag's id is its name because tapping one searches for it, and a bare tag name is
      // a keyword query the API answers well. Its slug is not.
      .map((name) => ({ id: name, title: titleCase(name) }));

    const sections = [
      linkSection("artists", "Artist", [...byType(TagType.Artist), ...byType(TagType.Group)]),
      linkSection("parodies", "Parody", byType(TagType.Parody)),
      linkSection("characters", "Characters", byType(TagType.Character)),
    ].filter((section) => section !== undefined);

    return {
      title: galleryTitle(titles),
      cover: mediaUrl(thumbs, gallery, readString(readRecord(gallery["cover"])["path"])),
      summary: summaryOf(gallery, byType),
      tags,
      contentType: ContentType.COMIC,
      contentRating: ContentRating.EXPLICIT,
      // The API publishes no status and there is nothing to map. A gallery is a finished
      // one-shot — the payload describing it already carries every page it will ever have —
      // so COMPLETED is a fact about the data rather than a default.
      status: PublicationStatus.COMPLETED,
      // Right-to-left. Translations keep the original panel order, so this holds for the
      // English galleries too.
      recommendedPanelMode: ReadingMode.PAGED_MANGA,
      webUrl: contentUrl(contentId),
      ...(readString(titles["japanese"]) === ""
        ? {}
        : { additionalTitles: [readString(titles["japanese"])] }),
      ...(sections.length === 0 ? {} : { additionalInfo: sections }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const gallery = await this.gallery(contentId);
    const count = pagesOf(gallery).length;
    if (count === 0) return [];

    // A gallery is one work, not a series: there is no chapter list to read anywhere on the
    // site. The single chapter stands in for the whole gallery, so its id is the gallery's.
    return [
      {
        chapterId: contentId,
        number: 1,
        index: 0,
        date: uploadDate(gallery["upload_date"]) ?? new Date(0),
        language: chapterLanguage(tagsByType(gallery)(TagType.Language)),
        title: count === 1 ? "1 page" : `${count} pages`,
        webUrl: contentUrl(contentId),
      },
    ];
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const gallery = await this.gallery(contentId);
    const { images } = await this.cdn();

    const pages: ChapterPage[] = pagesOf(gallery).map((page) => ({
      url: mediaUrl(images, gallery, readString(page["path"])),
    }));

    if (pages.length === 0) {
      throw new Error(
        `nhentai returned no pages for gallery ${contentId} (chapter ${chapterId}). The gallery may have been removed.`,
      );
    }

    return { pages };
  }

  private async popular(): Promise<PagedSearchResult> {
    // Alone among the listing endpoints this one answers with a bare JSON array rather than
    // the {result, num_pages, ...} envelope, and it is not paginated.
    const response = await this.http.get(`${API_URL}/galleries/popular`);
    const results = await this.highlights(readArray(safeParse(response.data)));
    return { results, isLastPage: true };
  }

  private async galleries(page: number): Promise<PagedSearchResult> {
    return this.listing(withQuery(`${API_URL}/galleries`, { page, per_page: PER_PAGE }), page);
  }

  private async tagged(query: TaggedQuery): Promise<PagedSearchResult> {
    const url = withQuery(`${API_URL}/galleries/tagged`, {
      tag_id: query.tagId,
      sort: query.sort,
      page: query.page,
      per_page: PER_PAGE,
    });
    return this.listing(url, query.page);
  }

  private async inLanguage(
    language: LanguageSpec,
    page: number,
    sort: string,
  ): Promise<PagedSearchResult> {
    return this.tagged({ page, tagId: language.tagId, sort });
  }

  private async searchGalleries(query: GalleryQuery): Promise<PagedSearchResult> {
    const url = withQuery(`${API_URL}/search`, {
      query: query.query,
      sort: query.sort,
      page: query.page,
    });
    return this.listing(url, query.page);
  }

  private async listing(url: string, page: number): Promise<PagedSearchResult> {
    const envelope = readRecord(safeParse((await this.http.get(url)).data));
    const results = await this.highlights(readArray(envelope["result"]));

    // `total` is null on /galleries/tagged even though the listing paginates correctly, and
    // the popular sorts cap the depth at 20 pages. `num_pages` is honest in every case.
    const lastPage = readNumber(envelope["num_pages"]) ?? page;
    return { results, isLastPage: page >= lastPage };
  }

  private async highlights(entries: readonly unknown[]): Promise<Highlight[]> {
    const { thumbs } = await this.cdn();
    return entries
      .map(readRecord)
      .map((entry) => toHighlight(entry, thumbs))
      .filter((highlight): highlight is Highlight => highlight !== undefined);
  }

  private async gallery(contentId: string): Promise<Record<string, unknown>> {
    const id = contentId.trim();
    if (!/^\d+$/.test(id)) {
      throw new Error(`"${contentId}" is not an nhentai gallery id — they are numeric.`);
    }

    const response = await this.http.get(`${API_URL}/galleries/${id}`);
    const gallery = readRecord(safeParse(response.data));
    if (readNumber(gallery["id"]) === undefined) {
      throw new Error(`nhentai has no gallery ${id}. It may have been removed.`);
    }
    return gallery;
  }

  private async tags(): Promise<Option[]> {
    if (this.tagOptions) return this.tagOptions;

    const url = withQuery(`${API_URL}/tags/tag`, {
      sort: "popular",
      per_page: TAG_OPTION_COUNT,
      page: 1,
    });
    const envelope = readRecord(safeParse((await this.http.get(url)).data));

    const options = readArray(envelope["result"])
      .map(readRecord)
      .map((tag) => readString(tag["name"]))
      .filter(Boolean)
      // The query fragment is built from the name, so that is what the option id has to be.
      .map((name) => ({ id: name, title: titleCase(name) }))
      .sort((a, b) => a.title.localeCompare(b.title));

    if (options.length === 0) {
      throw new Error("nhentai returned no tags, so the tag filter would be empty.");
    }

    this.tagOptions = options;
    return options;
  }

  private async cdn(): Promise<Servers> {
    if (this.servers) return this.servers;

    const config = await this.cdnConfig();
    const images = readArray(config["image_servers"]).map(readString).filter(Boolean);
    const thumbs = readArray(config["thumb_servers"]).map(readString).filter(Boolean);

    this.servers = {
      images: images.length > 0 ? images : DEFAULT_IMAGE_SERVERS,
      thumbs: thumbs.length > 0 ? thumbs : DEFAULT_THUMB_SERVERS,
    };
    return this.servers;
  }

  private async cdnConfig(): Promise<Record<string, unknown>> {
    try {
      return readRecord(safeParse((await this.http.get(`${API_URL}/cdn`)).data));
    } catch {
      // The published list is an optimisation over the constants in model.ts; a failed
      // config call must not take every cover and page down with it.
      return {};
    }
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

/** `upload_date` is Unix seconds, so the raw value is a 1970 date if used directly. */
function uploadDate(value: unknown): Date | undefined {
  const seconds = readNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

// -- site shapes -------------------------------------------------------------

function contentUrl(contentId: string): string {
  return `${BASE_URL}/g/${encodeURIComponent(contentId)}`;
}

/**
 * The two CDN pools are not interchangeable: `image_servers` serve only full pages
 * (`4.webp`) and `thumb_servers` only covers and thumbnails (`cover.webp.webp`,
 * `thumb.webp`, `4t.webp`). Asking the wrong pool drops the connection rather than
 * answering 404, so a mix-up shows as blank tiles with nothing logged anywhere.
 *
 * Paths arrive with a doubled extension often enough (`cover.webp.webp`) to look like a
 * bug, but that is the path that serves — pass `path` through exactly as the API gave it.
 */
function mediaUrl(
  servers: readonly string[],
  gallery: Record<string, unknown>,
  path: string,
): string {
  if (servers.length === 0 || path === "") return "";
  // Derived from media_id rather than picked at random so one image keeps one URL across
  // calls and the app's image cache stays warm.
  const mediaId = readNumber(gallery["media_id"]) ?? 0;
  return `${servers[Math.abs(Math.trunc(mediaId)) % servers.length]}/${path}`;
}

function pagesOf(gallery: Record<string, unknown>): Record<string, unknown>[] {
  return readArray(gallery["pages"])
    .map(readRecord)
    .filter((page) => readString(page["path"]) !== "")
    .sort((a, b) => (readNumber(a["number"]) ?? 0) - (readNumber(b["number"]) ?? 0));
}

const OPENING = "[(";
const CLOSING = "])";

/** Index of the bracket closing the group that opens at `start`, or -1 if it never closes. */
function closingIndex(value: string, start: number): number {
  let depth = 0;
  for (let i = start; i < value.length; i++) {
    const character = value.charAt(i);
    if (OPENING.includes(character)) depth++;
    else if (CLOSING.includes(character) && --depth === 0) return i;
  }
  return -1;
}

/** The same scan backwards, for a group that ends at `end`. */
function openingIndex(value: string, end: number): number {
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const character = value.charAt(i);
    if (CLOSING.includes(character)) depth++;
    else if (OPENING.includes(character) && --depth === 0) return i;
  }
  return -1;
}

/**
 * Uploaders name galleries `[Circle (Artist)] Real Title [Digital] [English]`. The detail
 * endpoint pre-computes the readable middle as `title.pretty`; listings carry only the raw
 * form, so the same trimming is applied to those by hand.
 *
 * The scan is depth-aware rather than a regex because the leading group nests — the artist
 * sits in parentheses inside the circle's brackets, and a character class cannot span that.
 * Stripping stops rather than emptying the string, so a title that is nothing but a
 * bracketed group survives intact.
 */
function prettyTitle(raw: string): string {
  let value = raw.trim();

  while (value !== "" && OPENING.includes(value.charAt(0))) {
    const close = closingIndex(value, 0);
    if (close < 0) break;
    value = value.slice(close + 1).trim();
  }

  while (value !== "" && CLOSING.includes(value.charAt(value.length - 1))) {
    const open = openingIndex(value, value.length - 1);
    if (open <= 0) break;
    value = value.slice(0, open).trim();
  }

  return value === "" ? raw.trim() : value;
}

function galleryTitle(titles: Record<string, unknown>): string {
  return (
    readString(titles["pretty"]) ||
    prettyTitle(readString(titles["english"])) ||
    readString(titles["japanese"]) ||
    "Untitled"
  );
}

function titleCase(value: string): string {
  return value.replace(/(^|[\s-])([a-z])/g, (_match, lead: string, letter: string) => {
    return `${lead}${letter.toUpperCase()}`;
  });
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function countLabel(value: number, singular: string): string {
  return `${formatCount(value)} ${value === 1 ? singular : `${singular}s`}`;
}

/** A listing entry carries tag ids but no tag names, so language is all that can be read. */
function listingLanguage(entry: Record<string, unknown>): string {
  for (const id of readArray(entry["tag_ids"])) {
    const language = LANGUAGE_BY_TAG_ID[readNumber(id) ?? -1];
    if (language) return language;
  }
  return "";
}

function toHighlight(
  entry: Record<string, unknown>,
  thumbs: readonly string[],
): Highlight | undefined {
  const id = readNumber(entry["id"]);
  const raw = readString(entry["english_title"]) || readString(entry["japanese_title"]);
  if (id === undefined || raw === "") return undefined;

  const pages = readNumber(entry["num_pages"]) ?? 0;
  const favorites = readNumber(entry["num_favorites"]) ?? 0;
  const subtitle = [
    listingLanguage(entry),
    pages > 0 ? countLabel(pages, "page") : "",
    favorites > 0 ? countLabel(favorites, "favourite") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: String(id),
    title: prettyTitle(raw),
    cover: mediaUrl(thumbs, entry, readString(entry["thumbnail"])),
    contentRating: ContentRating.EXPLICIT,
    webUrl: contentUrl(String(id)),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

type TagLookup = (type: string) => Record<string, unknown>[];

function tagsByType(gallery: Record<string, unknown>): TagLookup {
  const tags = readArray(gallery["tags"]).map(readRecord);
  return (type) => tags.filter((tag) => readString(tag["type"]) === type);
}

function namesOf(tags: readonly Record<string, unknown>[]): string[] {
  return tags.map((tag) => titleCase(readString(tag["name"]))).filter(Boolean);
}

function sentenceList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * The API has no summary field of any kind. Rather than show an empty description, this
 * composes one from the metadata that does exist, so the title view reads as prose.
 */
function summaryOf(gallery: Record<string, unknown>, byType: TagLookup): string {
  const format = namesOf(byType(TagType.Category))[0] ?? "gallery";
  const pages = readNumber(gallery["num_pages"]) ?? pagesOf(gallery).length;
  const artists = namesOf(byType(TagType.Artist));
  const groups = namesOf(byType(TagType.Group));
  const parodies = namesOf(byType(TagType.Parody)).filter((name) => name !== "Original");
  const characters = namesOf(byType(TagType.Character));
  const languages = namesOf(byType(TagType.Language)).filter((name) => name !== "Translated");
  const favorites = readNumber(gallery["num_favorites"]) ?? 0;

  const opening = [
    pages > 0 ? `A ${pages}-page ${format.toLowerCase()}` : `A ${format.toLowerCase()}`,
    artists.length > 0 ? ` by ${sentenceList(artists)}` : "",
    groups.length > 0 ? ` of ${sentenceList(groups)}` : "",
    languages.length > 0 ? `, in ${sentenceList(languages)}` : "",
  ].join("");

  const sentences = [
    `${opening}.`,
    parodies.length > 0 ? `A parody of ${sentenceList(parodies)}.` : "",
    characters.length > 0 ? `Features ${sentenceList(characters)}.` : "",
    favorites > 0 ? `Favourited by ${countLabel(favorites, "reader")}.` : "",
  ];

  return sentences.filter(Boolean).join(" ");
}

function linkSection(id: string, title: string, tags: readonly Record<string, unknown>[]) {
  const items: LinkItem[] = tags
    .map((tag) => ({ name: readString(tag["name"]), url: readString(tag["url"]) }))
    .filter((tag) => tag.name !== "")
    .map((tag) =>
      additionalInfo.links.item({
        id: tag.name,
        title: titleCase(tag.name),
        url: tag.url === "" ? BASE_URL : `${BASE_URL}${tag.url}`,
      }),
    );

  if (items.length === 0) return undefined;
  return additionalInfo.links.section({ id, title, items });
}

const CHAPTER_LANGUAGES: Record<string, DefinedLanguages> = {
  english: DefinedLanguages.ENGLISH,
  japanese: DefinedLanguages.JAPANESE,
  chinese: DefinedLanguages.CHINESE,
};

function chapterLanguage(tags: readonly Record<string, unknown>[]): DefinedLanguages {
  for (const tag of tags) {
    const language = CHAPTER_LANGUAGES[readString(tag["name"]).toLowerCase()];
    if (language) return language;
  }
  // "translated" is a language tag on this site but names no language, and it is the only
  // one some galleries carry. Untranslated is the site's default state.
  return DefinedLanguages.JAPANESE;
}

// -- search query ------------------------------------------------------------

/** A picker's "Any" row means "omit the facet", which is not a value the API accepts. */
function chosen(value: string): string {
  return value === ANY ? "" : value;
}

/**
 * Values holding a space have to be quoted or the API parses the second word as a separate
 * keyword and silently widens the result set. An embedded quote would break the grammar the
 * same way, so it is dropped rather than escaped.
 */
function facet(name: string, value: string): string {
  const cleaned = value.replace(/"/g, "").trim();
  if (cleaned === "") return "";
  return /\s/.test(cleaned) ? `${name}:"${cleaned}"` : `${name}:${cleaned}`;
}

function atLeast(name: string, value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${name}:>=${Math.floor(value)}`;
}

/**
 * `preferred` is the language from the source's settings. It fills in only where the reader
 * left the filter on "Any language", so a language picked for one search still wins.
 */
function buildQuery(raw: string | undefined, filters: FilterReader, preferred: string): string {
  const tags = filters.excludable(FilterID.Tags);

  const parts = [
    (raw ?? "").trim(),
    facet("language", chosen(filters.option(FilterID.Language)) || preferred),
    facet("category", chosen(filters.option(FilterID.Category))),
    facet("artist", filters.text(FilterID.Artist)),
    facet("parody", filters.text(FilterID.Parody)),
    ...tags.included.map((tag) => facet("tag", tag)),
    // Filtering first: a tag that reduces to nothing would otherwise leave a bare "-",
    // which the API reads as a keyword rather than an exclusion.
    ...tags.excluded
      .map((tag) => facet("tag", tag))
      .filter(Boolean)
      .map((part) => `-${part}`),
    atLeast("pages", filters.number(FilterID.MinPages)),
    atLeast("favorites", filters.number(FilterID.MinFavorites)),
  ].filter(Boolean);

  return parts.length === 0 ? MATCH_ALL_QUERY : parts.join(" ");
}

export class Target extends NhentaiSource {}
