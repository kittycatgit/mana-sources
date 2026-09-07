import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SearchPicker,
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
  toPageSections,
  type PreferenceValue,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ALL_LANGUAGES,
  ANY_TAG,
  ANY_TYPE,
  AREA_BY_NAMESPACE,
  BASE_URL,
  FilterID,
  IMAGE_DOMAIN,
  IMAGE_KEY_TTL,
  LANGUAGE_CODES,
  LANGUAGE_OPTIONS,
  LTN_URL,
  ListID,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  TAG_INDEX_URL,
  TAG_NAMESPACES,
  THUMBNAIL_URL,
  TYPE_TITLES,
  languageTitle,
  searchFields,
  type GalleryInfo,
  type ImageKey,
  type Listing,
  type Suggestion,
  type TermTarget,
} from "./model.ts";

const info: SourceInfo = {
  id: "hitomi",
  name: "Hitomi",
  version: "1.1.0",
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

/** How many galleries the site puts in one Atom feed, and so in one listing. */
const FEED_SIZE = 25;
const GALLERY_CACHE_SIZE = 200;

class HitomiSource
  implements ChapterSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private tagOptions: Option[] | undefined;
  private imageKey: ImageKey | undefined;
  private readonly galleries = new Map<string, GalleryInfo>();
  private readonly preferences = new PreferenceStore<Record<string, PreferenceValue>>(
    info.id,
    PREFERENCE_DEFAULTS,
  );

  private get http(): NetworkClient {
    // Every endpoint lives on a static CDN that the site itself hits 25 times per page
    // view, and a listing is one metadata request per gallery, so the limit is set for a
    // CDN rather than for an application server.
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

    return [
      {
        id: ListID.Latest,
        title: "Just Added",
        subtitle: everything
          ? "The newest uploads in every language"
          : `The newest ${languageTitle(language)} uploads`,
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: (page) => this.listing({ language }, page),
      },
      // The English shortcut only earns its place while no language is set: with one set it
      // is either the same feed as Just Added or the one language the reader ruled out.
      ...(everything
        ? [
            {
              id: ListID.English,
              title: "New in English",
              style: SectionStyle.DetailedTripleRowPaged,
              limit: 12,
              load: (page: number) => this.listing({ language: "english" }, page),
            },
          ]
        : []),
      {
        id: ListID.Doujinshi,
        title: "Doujinshi",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ area: "type", term: "doujinshi", language }, page),
      },
      {
        id: ListID.Manga,
        title: "Manga",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 12,
        load: (page) => this.listing({ area: "type", term: "manga", language }, page),
      },
      {
        id: ListID.GameCG,
        title: "Game CG",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 12,
        load: (page) => this.listing({ area: "type", term: "gamecg", language }, page),
      },
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
    return buildSearchForm({
      header: "Filters",
      footer:
        "Hitomi lists one term at a time. Anything typed in the search box wins over the " +
        "tag picked below, and the search box matches tags, artists, series, characters " +
        "and groups — not gallery titles.",
      fields: searchFields(await this.preferredLanguage()),
      tags: SearchPicker({
        id: FilterID.Tag,
        title: "Tag",
        options: await this.tags(),
      }),
      tagsHeader: "Tags",
      // Every feed is newest-first and the site offers no other order on them.
      includeSort: false,
    });
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(await this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(await this.sections(), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const sections = await this.sections();
    const list = listResults(sections, request);
    if (list) return list;

    const filters = new FilterReader(request);
    const selected = filters.option(FilterID.Language, ALL_LANGUAGES);
    const language = selected === ALL_LANGUAGES ? await this.preferredLanguage() : selected;
    const query = request.query?.trim() ?? "";

    if (query) {
      const term = await this.resolveTerm(query);
      // Hitomi indexes tags, artists, series, characters and groups, not gallery titles, so
      // a query naming none of them has no results rather than having gone wrong.
      if (!term) return { results: [], isLastPage: true };
      return this.listing({ ...term, language: term.language ?? language }, pageOf(request));
    }

    const tag = filters.option(FilterID.Tag, ANY_TAG);
    if (tag !== ANY_TAG) {
      return this.listing({ ...splitTerm(tag), language }, pageOf(request));
    }

    const type = filters.option(FilterID.Type, ANY_TYPE);
    if (type !== ANY_TYPE) {
      return this.listing({ area: "type", term: type, language }, pageOf(request));
    }

    return this.listing({ language }, pageOf(request));
  }

  async getContent(contentId: string): Promise<Content> {
    const gallery = await this.gallery(contentId);
    const japaneseTitle = gallery.japanese_title ?? "";

    const tags: Tag[] = (gallery.tags ?? []).map((entry) => ({
      id: tagId(entry.tag, entry.female === "1", entry.male === "1"),
      title: tagTitle(entry.tag, entry.female === "1", entry.male === "1"),
      contentRating: ContentRating.EXPLICIT,
    }));

    const sections = [
      creditSection(
        "artists",
        "Artists",
        (gallery.artists ?? []).map((entry) => entry.artist),
      ),
      creditSection(
        "groups",
        "Circles",
        (gallery.groups ?? []).map((entry) => entry.group),
      ),
      creditSection(
        "series",
        "Series",
        (gallery.parodys ?? []).map((entry) => entry.parody),
      ),
      characterSection((gallery.characters ?? []).map((entry) => entry.character)),
    ].filter((section) => section !== undefined);

    return {
      title: galleryTitle(gallery, contentId),
      cover: coverUrl(gallery),
      summary: summaryOf(gallery),
      tags,
      contentType: ContentType.COMIC,
      contentRating: ContentRating.EXPLICIT,
      // A Hitomi gallery is a finished upload, not a serial — the site has no status
      // wording at all, and every entry is complete on the day it appears.
      status: PublicationStatus.COMPLETED,
      webUrl: webUrl(gallery, contentId),
      ...(japaneseTitle === "" ? {} : { additionalTitles: [japaneseTitle] }),
      ...(sections.length === 0 ? {} : { additionalInfo: sections }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const gallery = await this.gallery(contentId);
    const count = (gallery.files ?? []).length;
    if (count === 0) return [];

    return [
      {
        chapterId: contentId,
        number: 1,
        index: 0,
        date:
          parseGalleryDate(gallery.date) ?? parseGalleryDate(gallery.datepublished) ?? new Date(0),
        language: LANGUAGE_CODES[gallery.language ?? ""] ?? DefinedLanguages.UNIVERSAL,
        title: count === 1 ? "1 page" : `${count} pages`,
        webUrl: webUrl(gallery, contentId),
      },
    ];
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const gallery = await this.gallery(contentId);
    const files = gallery.files ?? [];
    if (files.length === 0) {
      throw new Error(
        `Hitomi lists no images for gallery ${contentId} (chapter ${chapterId}). Video galleries and withdrawn uploads have none.`,
      );
    }

    const key = await this.imageKeys();
    return { pages: files.map((file) => ({ url: pageUrl(file.hash, key) })) };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    // Both image CDNs answer 404 — not 403 — to a request without the site as its referer,
    // which reads as a missing file rather than a rejection.
    return { url: imageURL, headers: { origin: BASE_URL, referer: `${BASE_URL}/` } };
  }

  private async listing(feed: Listing, page: number): Promise<PagedSearchResult> {
    // An Atom feed is the only listing endpoint that answers as text: the paged ones are
    // `.nozomi` files, arrays of big-endian int32 gallery ids, and the runtime hands every
    // response back as a UTF-8 string that mangles them. So a listing is one feed deep.
    if (page > 1) return { results: [], isLastPage: true };

    const ids = await this.feedIds(feed);
    if (ids.length === 0) return { results: [], isLastPage: true };

    const galleries = await Promise.all(
      ids.map((id) => this.gallery(id).catch((): GalleryInfo | undefined => undefined)),
    );
    const found = galleries.filter((gallery): gallery is GalleryInfo => gallery !== undefined);
    if (found.length === 0) {
      throw new Error(
        `Hitomi listed ${ids.length} galleries for ${feedUrl(feed)} but returned metadata for none of them.`,
      );
    }

    return { results: found.map(toHighlight), isLastPage: true };
  }

  private async feedIds(feed: Listing): Promise<string[]> {
    const url = feedUrl(feed);
    const response = await this.http.get(url);

    // The feed is machine-generated Atom whose every entry id is the gallery's own page
    // URL, so the trailing number is the id. The feed's own <id> has no trailing number
    // and drops out of the match for free.
    const ids: string[] = [];
    const seen = new Set<string>();
    const pattern = /<id>[^<]*-(\d+)\.html<\/id>/g;
    let match = pattern.exec(response.data);
    while (match !== null) {
      const id = match[1] ?? "";
      if (id !== "" && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
      match = pattern.exec(response.data);
    }

    return ids.slice(0, FEED_SIZE);
  }

  private async gallery(contentId: string): Promise<GalleryInfo> {
    const cached = this.galleries.get(contentId);
    if (cached) return cached;

    if (!/^\d+$/.test(contentId)) {
      throw new Error(`"${contentId}" is not a Hitomi gallery id — they are all numeric.`);
    }

    const response = await this.http.get(`${LTN_URL}/galleries/${contentId}.js`);
    const start = response.data.indexOf("{");
    if (start < 0) {
      throw new Error(`Hitomi has no gallery ${contentId}.`);
    }

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

  private async tags(): Promise<Option[]> {
    if (this.tagOptions) return this.tagOptions;

    const lists = await Promise.all(
      TAG_NAMESPACES.map((namespace) => this.suggestions(`${TAG_INDEX_URL}/${namespace}.json`)),
    );

    const options: Option[] = [{ id: ANY_TAG, title: "Any tag" }];
    for (const [name, , namespace] of lists.flat()) {
      const female = namespace === "female";
      const male = namespace === "male";
      options.push({ id: tagId(name, female, male), title: tagTitle(name, female, male) });
    }

    this.tagOptions = options;
    return options;
  }

  /**
   * Turns what the user typed into the one namespaced term a feed can carry, the way the
   * site's own search box does: an explicit `namespace:value` is taken as written, and a
   * bare word is looked up in the tag index one character per path segment.
   */
  private async resolveTerm(query: string): Promise<TermTarget | undefined> {
    const typed = query.toLowerCase().replace(/_/g, " ");
    if (typed.includes(":")) return splitTerm(typed);

    const path = typed
      .split("")
      .map((character) => encodeURIComponent(SEARCH_PATH_ESCAPES[character] ?? character))
      .join("/");
    const matches = await this.suggestions(`${TAG_INDEX_URL}/global/${path}.json`);

    const best = bestMatch(matches, typed);
    if (!best) return undefined;

    const [name, , namespace] = best;
    return splitTerm(namespace === "tag" ? name : `${namespace}:${name}`);
  }

  private async preferredLanguage(): Promise<string> {
    const stored = await this.preferences.get(PreferenceID.Language);
    if (typeof stored !== "string" || stored === "") return ALL_LANGUAGES;
    return LANGUAGE_OPTIONS.some((option) => option.id === stored) ? stored : ALL_LANGUAGES;
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
}

// -- feeds -------------------------------------------------------------------

function feedUrl(feed: Listing): string {
  const language = encodeURIComponent(feed.language || ALL_LANGUAGES);
  if (!feed.area || !feed.term) return `${LTN_URL}/index-${language}.atom`;
  // The site strips these two characters from a term before putting it in a path rather
  // than escaping them, so a term carrying one only resolves if we strip them too.
  const term = encodeURIComponent(feed.term.replace(/[/#]/g, ""));
  return `${LTN_URL}/${feed.area}/${term}-${language}.atom`;
}

/**
 * The tag index matches a query anywhere in a term and orders what it finds by gallery
 * count, so a longer term outranks the exact one that was typed — "dragon ball" comes back
 * behind "dragon ball z". An exact name therefore wins outright, and the count only decides
 * between equals.
 */
function bestMatch(matches: readonly Suggestion[], query: string): Suggestion | undefined {
  return matches.find(([name]) => name === query) ?? matches[0];
}

/**
 * Splits `namespace:value` into the feed directory and term it names. `language` is only
 * ever set for a `language:` term — leaving it unset everywhere else is what lets the
 * Language filter still apply on top of a term search.
 */
function splitTerm(value: string): TermTarget {
  const separator = value.indexOf(":");
  if (separator < 0) return { area: "tag", term: value };

  const namespace = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (namespace === "language") return { language: name };

  const area = AREA_BY_NAMESPACE[namespace];
  if (!area) return { area: "tag", term: value };
  // `female:` and `male:` are not directories — the namespace stays part of the term.
  const term = area === "tag" && namespace !== "tag" ? value : name;
  return { area, term };
}

// -- images ------------------------------------------------------------------

/**
 * Reads the two values every full-size image URL needs out of `gg.js`: the rotating path
 * prefix, and the switch mapping a gallery's hash bucket to an image subdomain. The file
 * is a hand-written script rather than data, so it is read as one — a bare `case N:` runs
 * until the `o = N` that closes its group, and that group's value belongs to every case
 * collected since the last one.
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
  const hash = (gallery.files ?? [])[0]?.hash ?? "";
  return hash === "" ? "" : thumbnailUrl(hash);
}

// -- gallery shapes ----------------------------------------------------------

function galleryTitle(gallery: GalleryInfo, contentId: string): string {
  return gallery.title?.trim() || gallery.japanese_title?.trim() || `Gallery ${contentId}`;
}

function webUrl(gallery: GalleryInfo, contentId: string): string {
  const path = gallery.galleryurl ?? "";
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

function toHighlight(gallery: GalleryInfo): Highlight {
  const artists = (gallery.artists ?? []).map((entry) => entry.artist);
  const pages = (gallery.files ?? []).length;
  const subtitle = [joinNames(artists), pages === 1 ? "1 page" : `${pages} pages`]
    .filter((part) => part !== "")
    .join(" · ");

  return {
    id: gallery.id,
    title: galleryTitle(gallery, gallery.id),
    cover: coverUrl(gallery),
    contentRating: ContentRating.EXPLICIT,
    webUrl: webUrl(gallery, gallery.id),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

/** Hitomi publishes no blurb, so the summary is written out of the metadata it does have. */
function summaryOf(gallery: GalleryInfo): string {
  const type = TYPE_TITLES[gallery.type ?? ""] ?? "Gallery";
  const artists = joinNames((gallery.artists ?? []).map((entry) => entry.artist));
  const groups = joinNames((gallery.groups ?? []).map((entry) => entry.group));
  const parodies = (gallery.parodys ?? []).map((entry) => entry.parody);
  const characters = joinNames((gallery.characters ?? []).map((entry) => entry.character));
  const pages = (gallery.files ?? []).length;
  const language = gallery.language_localname ?? titleCase(gallery.language ?? "");

  const credit = artists === "" ? (groups === "" ? "" : ` from ${groups}`) : ` by ${artists}`;
  const extent = [
    pages === 0 ? "" : pages === 1 ? "1 page" : `${pages} pages`,
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

/** `encode_search_query_for_url` in the site's search.js, which the tag index paths use. */
const SEARCH_PATH_ESCAPES: Record<string, string> = {
  " ": "_",
  "/": "slash",
  ".": "dot",
};

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
function parseGalleryDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;

  const full = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/.exec(
    raw,
  );
  if (full) {
    const parsed = new Date(`${full[1]}T${full[2]}${full[3]}:${full[4] ?? "00"}`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
  }

  return undefined;
}

export class Target extends HitomiSource {}
