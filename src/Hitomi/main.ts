import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  PublicationStatus,
  SearchPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterSource,
  type Content,
  type Form,
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
  type SourceInfo,
  type SourcePreferenceProvider,
  type Tag,
} from "@mana-app/types";

import { buildClient } from "./client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSection,
  resolveSortId,
  fillPageSections,
  type PreferenceValue,
  type SectionSpec,
} from "./forms/index.ts";
import {
  newCursor,
  planKey,
  resolvePage,
  listLength,
  type IdPlan,
  type ListRef,
  type PlanCursor,
} from "./ids.ts";
import {
  ALL_LANGUAGES,
  ANY_TAG,
  ANY_TYPE,
  BASE_URL,
  DEFAULT_READING,
  FilterID,
  IMAGE_DOMAIN,
  IMAGE_KEY_TTL,
  INDEX_VERSION_TTL,
  LANGUAGE_CODES,
  LANGUAGE_OPTIONS,
  LTN_URL,
  ListID,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  READING_BY_TYPE,
  SORT_OPTIONS,
  SortID,
  TAG_INDEX_URL,
  TAG_NAMESPACES,
  THUMBNAIL_URL,
  TYPE_ROWS,
  TYPE_TITLES,
  languageTitle,
  nozomiUrl,
  searchFields,
  splitTerm,
  type GalleryInfo,
  type ImageKey,
  type Suggestion,
  type TermTarget,
  type Text,
} from "./model.ts";
import { indexVersion, wordIds } from "./search-index.ts";

const info: SourceInfo = {
  id: "hitomi",
  name: "Hitomi",
  version: "1.5.3",
  description: "Reads doujinshi, manga and CG sets from hitomi.la",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [
    DefinedLanguages.JAPANESE,
    DefinedLanguages.ENGLISH,
    DefinedLanguages.CHINESE,
    DefinedLanguages.KOREAN,
    DefinedLanguages.SPANISH,
    DefinedLanguages.PORTUGUESE,
    DefinedLanguages.FRENCH,
  ],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["hitomi.la"],
};

const GALLERY_CACHE_SIZE = 300;
const WORD_CACHE_SIZE = 40;
const CURSOR_CACHE_SIZE = 12;
/** What a home row shows. The listing behind it keeps returning the site's own 25. */
const ROW_LIMIT = 12;
const HERO_LIMIT = 6;

type ParsedTerm = { value: string; negated: boolean };

/** A gallery record together with the id the listing filed it under. */
type Listed = { id: string; gallery: GalleryInfo };

class HitomiSource
  implements ChapterSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private imageKey: ImageKey | undefined;
  private version: { value: string; fetchedAt: number } | undefined;
  private tagOptions: Option[] | undefined;
  private readonly galleries = new Map<string, GalleryInfo>();
  private readonly words = new Map<string, number[]>();
  private readonly cursors = new Map<string, PlanCursor>();
  private readonly preferences = new PreferenceStore<Record<string, PreferenceValue>>(
    info.id,
    PREFERENCE_DEFAULTS,
  );

  private get http(): NetworkClient {
    // Everything is a static file on a CDN the site itself hits 25 times per page view,
    // and a row of twelve is twelve gallery records, so the limit is set for a CDN rather
    // than for an application server.
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 20,
      interval: 1,
      accept: "*/*",
    });
    return this.client;
  }

  private async sections(): Promise<SectionSpec[]> {
    const language = await this.preferredLanguage();
    const everything = language === ALL_LANGUAGES;
    const scope = everything ? "" : ` in ${languageTitle(language)}`;
    const row = (id: string, title: string, subtitle: string, terms: string[], sort: string) => ({
      id,
      title,
      subtitle,
      style: SectionStyle.DetailedTripleRowPaged,
      limit: ROW_LIMIT,
      load: (page: number) => this.listing(terms, language, sort, page),
    });

    return [
      {
        id: ListID.Today,
        title: "Popular Today",
        subtitle: `The day's most read${scope}`,
        style: SectionStyle.SimpleHero,
        limit: HERO_LIMIT,
        load: (page) => this.listing([], language, SortID.Today, page),
      },
      {
        id: ListID.Latest,
        title: "Just Added",
        subtitle: everything
          ? "The newest uploads in every language"
          : `The newest ${languageTitle(language)} uploads`,
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: ROW_LIMIT,
        load: (page) => this.listing([], language, SortID.Date, page),
      },
      row(ListID.Week, "Popular This Week", `The week's most read${scope}`, [], SortID.Week),
      row(ListID.Month, "Popular This Month", `The month's most read${scope}`, [], SortID.Month),
      row(ListID.Year, "Popular This Year", `The year's most read${scope}`, [], SortID.Year),
      ...TYPE_ROWS.map((type) =>
        row(
          type.id,
          type.title,
          `The newest ${type.title.toLowerCase()}${scope}`,
          [`type:${type.type}`],
          SortID.Date,
        ),
      ),
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, [
      {
        header: "Content",
        footer:
          "Every listing, the home page and search alike, is narrowed to this language. " +
          "The Language filter in search still overrides it for one search at a time.",
        fields: [
          {
            type: "select",
            key: PreferenceID.Language,
            title: "Language",
            options: LANGUAGE_OPTIONS,
          },
        ],
      },
    ]);
  }

  async getSearchForm(): Promise<SearchForm> {
    const tags = await this.tags();
    return buildSearchForm({
      header: "Filters",
      footer:
        "The search box takes the same terms the site's own does: several words narrow " +
        "each other, -word excludes one, and namespace:value picks a namespace — tag, " +
        "female, male, artist, series, character, group, type or language.",
      fields: searchFields(await this.preferredLanguage()),
      ...(tags.length > 1
        ? {
            tags: SearchPickerSheet({ id: FilterID.Tag, title: "Tag", options: tags }),
            tagsHeader: "Tags",
          }
        : {}),
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return fillPageSections(await this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(await this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(await this.sections(), request);
    if (list) return list;

    const filters = new FilterReader(request);
    const chosen = filters.option(FilterID.Language, ALL_LANGUAGES);
    const language = chosen === ALL_LANGUAGES ? await this.preferredLanguage() : chosen;

    const terms = parseQuery(request.query ?? "");
    const tag = filters.option(FilterID.Tag, ANY_TAG);
    if (tag !== ANY_TAG) terms.push({ value: tag, negated: false });
    const type = filters.option(FilterID.Type, ANY_TYPE);
    if (type !== ANY_TYPE) terms.push({ value: `type:${type}`, negated: false });

    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Date);
    return this.results(terms, language, sort, pageOf(request));
  }

  async getContent(contentId: string): Promise<Content> {
    const id = String(contentId);
    const gallery = await this.gallery(id);
    const japaneseTitle = text(gallery.japanese_title).trim();

    const tags: Tag[] = (gallery.tags ?? []).map((entry) => {
      const name = text(entry.tag);
      const female = flag(entry.female);
      const male = flag(entry.male);
      return {
        id: tagId(name, female, male),
        title: tagTitle(name, female, male),
        contentRating: ContentRating.EXPLICIT,
      };
    });

    const sections = [
      creditSection("artists", "Artists", artistNames(gallery)),
      creditSection("groups", "Circles", groupNames(gallery)),
      creditSection("series", "Series", parodyNames(gallery)),
      characterSection(characterNames(gallery)),
    ].filter((section) => section !== undefined);

    const reading = READING_BY_TYPE[text(gallery.type)] ?? DEFAULT_READING;

    return {
      title: galleryTitle(gallery, id),
      cover: coverUrl(gallery),
      summary: summaryOf(gallery),
      tags,
      contentType: reading.contentType,
      recommendedPanelMode: reading.readingMode,
      contentRating: ContentRating.EXPLICIT,
      // A gallery is a finished upload rather than a serial: the site publishes no status
      // wording at all, and every entry is complete on the day it appears.
      status: PublicationStatus.COMPLETED,
      webUrl: webUrl(gallery, id),
      ...(japaneseTitle === "" ? {} : { additionalTitles: [japaneseTitle] }),
      ...(sections.length === 0 ? {} : { additionalInfo: sections }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const id = String(contentId);
    const gallery = await this.gallery(id);
    const count = (gallery.files ?? []).length;
    if (count === 0) return [];

    return [
      {
        chapterId: id,
        number: 1,
        index: 0,
        date:
          parseGalleryDate(gallery.date) ?? parseGalleryDate(gallery.datepublished) ?? new Date(0),
        language: LANGUAGE_CODES[text(gallery.language)] ?? DefinedLanguages.UNIVERSAL,
        title: count === 1 ? "1 page" : `${count} pages`,
        webUrl: webUrl(gallery, id),
      },
    ];
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const id = String(contentId);
    const gallery = await this.gallery(id);
    const files = gallery.files ?? [];
    if (files.length === 0) {
      throw new Error(
        `Hitomi lists no images for gallery ${id} (chapter ${String(chapterId)}). Video galleries and withdrawn uploads have none.`,
      );
    }

    const key = await this.imageKeys();
    return { pages: files.map((file) => ({ url: pageUrl(text(file.hash), key) })) };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Both image hosts answer 404 — not 403 — to a request without the site as its referer,
    // which reads as a missing file rather than as a rejection.
    return { url: imageURL, headers: { origin: BASE_URL, referer: `${BASE_URL}/` } };
  }

  /** A home row: the same query as a search, with the row's own terms and order. */
  private listing(
    terms: readonly string[],
    language: string,
    sort: string,
    page: number,
  ): Promise<PagedSearchResult> {
    return this.results(
      terms.map((value) => ({ value, negated: false })),
      language,
      sort,
      page,
    );
  }

  private async results(
    terms: readonly ParsedTerm[],
    language: string,
    sort: string,
    page: number,
  ): Promise<PagedSearchResult> {
    const plan = await this.plan(terms, language, sort);
    const key = planKey(plan);
    let cursor = this.cursors.get(key);
    if (cursor === undefined) {
      if (this.cursors.size >= CURSOR_CACHE_SIZE) this.cursors.clear();
      cursor = newCursor();
      this.cursors.set(key, cursor);
    }

    const { ids, isLastPage } = await resolvePage(this.http, plan, page, cursor);
    if (ids.length === 0) return { results: [], isLastPage: true };

    const found = await this.galleriesFor(ids);
    if (found.length === 0) {
      throw new Error(
        `Hitomi listed ${ids.length} galleries for this page but returned metadata for none of them.`,
      );
    }
    return { results: found.map((entry) => toHighlight(entry.id, entry.gallery)), isLastPage };
  }

  /**
   * Turns a set of terms into the lists to intersect and the one that decides the order.
   *
   * The site files a listing per namespaced name and per popularity window, so a term that
   * names one is a file to read rather than a set to hold: it becomes the ordering list
   * whenever it can, which is what keeps a filtered browse to a single ranged request. Only
   * a bare word has to come from the gallery index, and only those are held whole.
   */
  private async plan(
    terms: readonly ParsedTerm[],
    requested: string,
    sort: string,
  ): Promise<IdPlan> {
    const areas: { area: string; term: string }[] = [];
    const wordTerms: string[] = [];
    const negatives: TermTarget[] = [];
    let language = requested;

    for (const entry of terms) {
      const target = splitTerm(entry.value);
      if (entry.negated) {
        negatives.push(target);
      } else if (target.kind === "language") {
        language = target.language;
      } else if (target.kind === "area") {
        areas.push({ area: target.area, term: target.term });
      } else {
        wordTerms.push(target.term);
      }
    }

    const excludes: ListRef[] = [];
    for (const target of negatives) {
      const ref = await this.listFor(target, language);
      if (ref) excludes.push(ref);
    }

    const words: ListRef[] = [];
    for (const term of wordTerms) {
      words.push({ kind: "ids", ids: await this.wordList(term) });
    }

    const areaLists = areas.map((entry) => ({
      kind: "nozomi" as const,
      url: nozomiUrl(entry.area, entry.term, language, SortID.Date),
    }));

    // A popularity window is a separate set of files rather than a re-ordering of one, so
    // the row that decides the order has to be read from that window's own file.
    if (sort !== SortID.Date) {
      const seed = areas[0];
      const driver: ListRef = {
        kind: "nozomi",
        url: nozomiUrl(seed?.area, seed?.term, language, sort),
      };
      return { driver, includes: [...areaLists.slice(1), ...words], excludes };
    }

    // Every date-ordered listing is its ids in descending order, so any of them can decide
    // the order, and the widest is the one that costs least to hold nothing of.
    if (areaLists.length > 0) {
      const at = areaLists.length === 1 ? 0 : await this.widest(areaLists);
      const includes = [...areaLists.filter((_, index) => index !== at), ...words];
      return { driver: areaLists[at]!, includes, excludes };
    }

    if (words.length > 0 && language === ALL_LANGUAGES) {
      const at = narrowest(words);
      return {
        driver: words[at]!,
        includes: words.filter((_, index) => index !== at),
        excludes,
      };
    }

    // A bare word is answered by a language-agnostic index, so a language reaches those
    // results only through the site-wide listing for it.
    const driver: ListRef = {
      kind: "nozomi",
      url: nozomiUrl(undefined, undefined, language, sort),
    };
    return { driver, includes: words, excludes };
  }

  /** A term as a list of ids. Excluded terms only ever ask "is this id in it", so the
   * date-ordered file answers for any order the results are shown in. */
  private async listFor(target: TermTarget, language: string): Promise<ListRef | undefined> {
    if (target.kind === "language") return undefined;
    if (target.kind === "area") {
      return { kind: "nozomi", url: nozomiUrl(target.area, target.term, language, SortID.Date) };
    }
    return { kind: "ids", ids: await this.wordList(target.term) };
  }

  /** Which of several listings holds the most ids, read from `content-range` alone. */
  private async widest(refs: readonly ListRef[]): Promise<number> {
    const lengths = await Promise.all(refs.map((ref) => listLength(this.http, ref)));
    let at = 0;
    for (let index = 1; index < lengths.length; index++) {
      if (lengths[index]! > lengths[at]!) at = index;
    }
    return at;
  }

  private async wordList(word: string): Promise<number[]> {
    const version = await this.indexVersion();
    const key = `${version}\n${word}`;
    const cached = this.words.get(key);
    if (cached) return cached;

    const ids = await wordIds(this.http, version, word);
    if (this.words.size >= WORD_CACHE_SIZE) this.words.clear();
    this.words.set(key, ids);
    return ids;
  }

  private async indexVersion(): Promise<string> {
    const held = this.version;
    if (held && Date.now() - held.fetchedAt < INDEX_VERSION_TTL) return held.value;
    const value = await indexVersion(this.http);
    this.version = { value, fetchedAt: Date.now() };
    return value;
  }

  /**
   * The listing's own id is the one carried through, not the `id` inside the record: the
   * CDN answers some `galleries/<id>.js` with a record filed under a different id, and that
   * id is the one the reader would then ask for.
   */
  private async galleriesFor(ids: readonly number[]): Promise<Listed[]> {
    const galleries = await Promise.all(
      ids.map(async (id): Promise<Listed | undefined> => {
        const contentId = String(id);
        const gallery = await this.gallery(contentId).catch(() => undefined);
        return gallery === undefined ? undefined : { id: contentId, gallery };
      }),
    );
    return galleries.filter((entry): entry is Listed => entry !== undefined);
  }

  private async gallery(contentId: string): Promise<GalleryInfo> {
    const cached = this.galleries.get(contentId);
    if (cached) return cached;

    if (!/^\d+$/.test(contentId)) {
      throw new Error(`"${contentId}" is not a Hitomi gallery id — they are all numeric.`);
    }

    const response = await this.http.get(`${LTN_URL}/galleries/${contentId}.js`);
    const start = response.data.indexOf("{");
    if (start < 0) throw new Error(`Hitomi has no gallery ${contentId}.`);

    const gallery = safeParse(response.data.slice(start)) as GalleryInfo | undefined;
    if (!gallery || typeof gallery !== "object") {
      throw new Error(`Hitomi returned unreadable metadata for gallery ${contentId}.`);
    }

    if (this.galleries.size >= GALLERY_CACHE_SIZE) this.galleries.clear();
    this.galleries.set(contentId, gallery);
    return gallery;
  }

  private async imageKeys(): Promise<ImageKey> {
    const cached = this.imageKey;
    if (cached && Date.now() - cached.fetchedAt < IMAGE_KEY_TTL) return cached;

    const response = await this.http.get(`${LTN_URL}/gg.js`);
    const key = parseImageKey(response.data);
    this.imageKey = key;
    return key;
  }

  /** The most-used names in each tag namespace, which is all the tag index publishes. */
  private async tags(): Promise<Option[]> {
    if (this.tagOptions) return this.tagOptions;

    const lists = await Promise.all(
      TAG_NAMESPACES.map((namespace) =>
        this.suggestions(`${TAG_INDEX_URL}/${namespace}.json`).catch((): Suggestion[] => []),
      ),
    );

    const options: Option[] = [{ id: ANY_TAG, title: "Any tag" }];
    for (const [name, , namespace] of lists.flat()) {
      const female = namespace === "female";
      const male = namespace === "male";
      options.push({
        id: female || male ? `${namespace}:${name}` : `tag:${name}`,
        title: tagTitle(name, female, male),
      });
    }

    this.tagOptions = options;
    return options;
  }

  private async suggestions(url: string): Promise<Suggestion[]> {
    const response = await this.http.get(url, { validateStatus: (status) => status < 500 });
    const parsed = safeParse(response.data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Suggestion =>
        Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[2] === "string",
    );
  }

  private async preferredLanguage(): Promise<string> {
    const stored = await this.preferences.get(PreferenceID.Language);
    if (typeof stored !== "string" || stored === "") return ALL_LANGUAGES;
    return LANGUAGE_OPTIONS.some((option) => option.id === stored) ? stored : ALL_LANGUAGES;
  }
}

// -- queries -----------------------------------------------------------------

/**
 * The site's own query grammar: whitespace separates terms that narrow each other, a `-`
 * excludes one, and an underscore stands for a space inside a name. Its ordering terms name
 * the listing to read rather than a term to match, and `or` is its grouping word; both are
 * dropped, because either would otherwise match nothing and empty the page.
 */
function parseQuery(query: string): ParsedTerm[] {
  const terms: ParsedTerm[] = [];
  for (const word of query.toLowerCase().trim().split(/\s+/)) {
    if (word === "" || word === "or") continue;
    if (/^(?:sort|order)by(?:key|direction)?:/.test(word)) continue;
    const negated = word.length > 1 && word.startsWith("-");
    const value = (negated ? word.slice(1) : word).replace(/_/g, " ");
    if (value !== "") terms.push({ value, negated });
  }
  return terms;
}

/** Among lists already held in memory, the smallest is the cheapest one to walk. */
function narrowest(refs: readonly ListRef[]): number {
  let at = 0;
  for (let index = 1; index < refs.length; index++) {
    const mine = refs[index];
    const best = refs[at];
    if (mine?.kind === "ids" && best?.kind === "ids" && mine.ids.length < best.ids.length) {
      at = index;
    }
  }
  return at;
}

// -- images ------------------------------------------------------------------

/**
 * Reads the two values every full-size image URL needs out of `gg.js`: the rotating path
 * prefix, and the switch mapping a gallery's hash bucket to an image subdomain. The file is
 * a hand-written script rather than data, so it is read as one — a bare `case N:` runs until
 * the `o = N` that closes its group, and that group's value belongs to every case collected
 * since the last one.
 */
function parseImageKey(source: string): ImageKey {
  const base = /b:\s*'([^']*)'/.exec(source)?.[1] ?? "";
  const fallback = Number.parseInt(/var\s+o\s*=\s*(\d+)/.exec(source)?.[1] ?? "", 10);
  if (base === "" || !Number.isFinite(fallback)) {
    throw new Error("Hitomi's gg.js no longer carries an image path prefix — its shape changed.");
  }

  const subdomains: Record<number, number> = {};
  const token = /case\s+(\d+):|o\s*=\s*(\d+)/g;
  let pending: number[] = [];
  let match = token.exec(source);
  while (match !== null) {
    if (match[1] !== undefined) {
      pending.push(Number.parseInt(match[1], 10));
    } else {
      const value = Number.parseInt(match[2] ?? "", 10);
      for (const bucket of pending) subdomains[bucket] = value;
      pending = [];
    }
    match = token.exec(source);
  }

  return { base: base.replace(/\/+$/, ""), fallback, subdomains, fetchedAt: Date.now() };
}

/** The last three hex digits of a hash, read as `<last><two before>`, pick its bucket. */
function bucketOf(hash: string): number {
  return Number.parseInt(hash.slice(-1) + hash.slice(-3, -1), 16);
}

function pageUrl(hash: string, key: ImageKey): string {
  const bucket = bucketOf(hash);
  const subdomain = 1 + (key.subdomains[bucket] ?? key.fallback);
  return `https://w${subdomain}.${IMAGE_DOMAIN}/${key.base}/${bucket}/${hash}.webp`;
}

/** Thumbnails sit on a fixed host under a path split out of the hash, with no gg.js key. */
function thumbnailUrl(hash: string): string {
  return `${THUMBNAIL_URL}/webpbigtn/${hash.slice(-1)}/${hash.slice(-3, -1)}/${hash}.webp`;
}

function coverUrl(gallery: GalleryInfo): string {
  const hash = text((gallery.files ?? [])[0]?.hash);
  return hash === "" ? "" : thumbnailUrl(hash);
}

// -- gallery shapes ----------------------------------------------------------

/** Every field the gallery JSON carries can arrive as a number; everything returned from
 * here is a string, and a number reaching the app fails the whole reply to decode. */
function text(value: Text | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** A tag's gender flag, which is `"1"` on some galleries and `1` on others. */
function flag(value: Text | undefined): boolean {
  return text(value) === "1";
}

function names(entries: readonly string[]): string[] {
  return entries.filter((name) => name !== "");
}

function artistNames(gallery: GalleryInfo): string[] {
  return names((gallery.artists ?? []).map((entry) => text(entry.artist)));
}

function groupNames(gallery: GalleryInfo): string[] {
  return names((gallery.groups ?? []).map((entry) => text(entry.group)));
}

function parodyNames(gallery: GalleryInfo): string[] {
  return names((gallery.parodys ?? []).map((entry) => text(entry.parody)));
}

function characterNames(gallery: GalleryInfo): string[] {
  return names((gallery.characters ?? []).map((entry) => text(entry.character)));
}

function galleryTitle(gallery: GalleryInfo, contentId: string): string {
  return (
    text(gallery.title).trim() || text(gallery.japanese_title).trim() || `Gallery ${contentId}`
  );
}

function webUrl(gallery: GalleryInfo, contentId: string): string {
  const path = text(gallery.galleryurl);
  if (path.startsWith("/")) return `${BASE_URL}${path}`;
  return `${BASE_URL}/galleries/${contentId}.html`;
}

function tagId(name: string, female: boolean, male: boolean): string {
  if (female) return `female:${name}`;
  if (male) return `male:${name}`;
  return name;
}

function tagTitle(name: string, female: boolean, male: boolean): string {
  if (female) return `${name} ♀`;
  if (male) return `${name} ♂`;
  return name;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function pageCount(gallery: GalleryInfo): string {
  const pages = (gallery.files ?? []).length;
  return pages === 1 ? "1 page" : `${pages} pages`;
}

function toHighlight(contentId: string, gallery: GalleryInfo): Highlight {
  const subtitle = [joinNames(artistNames(gallery)), pageCount(gallery)]
    .filter((part) => part !== "")
    .join(" · ");

  return {
    id: contentId,
    title: galleryTitle(gallery, contentId),
    cover: coverUrl(gallery),
    contentRating: ContentRating.EXPLICIT,
    webUrl: webUrl(gallery, contentId),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

/** Hitomi publishes no blurb, so the summary is written out of the metadata it does have. */
function summaryOf(gallery: GalleryInfo): string {
  const type = TYPE_TITLES[text(gallery.type)] ?? "Gallery";
  const artists = joinNames(artistNames(gallery));
  const groups = joinNames(groupNames(gallery));
  const parodies = parodyNames(gallery);
  const characters = joinNames(characterNames(gallery));
  const language = text(gallery.language_localname) || titleCase(text(gallery.language));

  const credit = artists === "" ? (groups === "" ? "" : ` from ${groups}`) : ` by ${artists}`;
  const extent = [
    (gallery.files ?? []).length === 0 ? "" : pageCount(gallery),
    language === "" ? "" : `in ${language}`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  const sentences = [`${type}${credit}${extent === "" ? "" : `, ${extent}`}.`];

  if (parodies.length === 1 && parodies[0] === "original") {
    sentences.push("An original work.");
  } else if (parodies.length > 0) {
    sentences.push(`A parody of ${joinNames(parodies.map(titleCase))}.`);
  }

  if (characters !== "") sentences.push(`Featuring ${characters}.`);

  const posted = parseGalleryDate(gallery.date);
  if (posted) sentences.push(`Posted ${posted.toISOString().slice(0, 10)}.`);

  return sentences.join(" ");
}

function creditSection(id: string, title: string, names: readonly string[]) {
  if (names.length === 0) return undefined;
  return additionalInfo.staff.section({
    id,
    title,
    hasMore: false,
    items: names.map((name) => additionalInfo.staff.item({ id: name, title: name })),
  });
}

function characterSection(names: readonly string[]) {
  if (names.length === 0) return undefined;
  return additionalInfo.characters.section({
    id: "characters",
    title: "Characters",
    hasMore: false,
    items: names.map((name) => additionalInfo.characters.item({ id: name, title: name })),
  });
}

// -- readers -----------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * `2026-09-06 00:14:00-05` and `2025-08-29` are the two shapes the site publishes. The
 * offset comes without minutes, which `Date` will not parse, so it is completed here.
 */
function parseGalleryDate(raw: Text | undefined): Date | undefined {
  const value = text(raw);
  if (value === "") return undefined;

  const full = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/.exec(
    value,
  );
  if (full) {
    const parsed = new Date(`${full[1]}T${full[2]}${full[3]}:${full[4] ?? "00"}`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
  }

  return undefined;
}

export class Target extends HitomiSource {}
