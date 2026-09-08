import {
  ContentType,
  PublicationStatus,
  SearchExcludableMultiPickerSheet,
  SearchMenuPicker,
  SearchMultiPickerSheet,
  type Option,
  type SearchListField,
  type SearchOptionField,
  type SortOption,
} from "@mana-app/types";

import type { PreferenceSection } from "./forms/index.ts";

export const BASE_URL = "https://mangaball.net";
export const SEARCH_API = `${BASE_URL}/api/v1/title/search-advanced/`;
export const LISTING_API = `${BASE_URL}/api/v1/title/search/`;
export const CHAPTERS_API = `${BASE_URL}/api/v1/chapter/chapter-listing-by-title-id/`;

export const ANY = "any";

/** `pagination.limit` on every `search-advanced` reply, regardless of what is asked for. */
export const PAGE_SIZE = 24;

/** `getFeatured` and `getByOrigin` ignore `search_limit` outright and always answer twelve. */
export const FEATURED_SIZE = 12;

/** `getRecommend` honours `search_limit` up to eighteen and caps there. */
export const RECOMMEND_SIZE = 18;

/** `getPopular` and `getRecentChapterRead` honour any `search_limit` they are given. */
export const TRENDING_SIZE = 20;

/**
 * `getRecentChapterRead` is the one listing served from a cache the site rebuilds on a miss,
 * and `search_limit` is part of that cache key — so the number asked for decides whether the
 * reply comes off the line the site's own home page keeps warm or off one only this source
 * ever asks for. Measured 2026-09-08: `day` cold at 13.1s, and a limit of 17 that nothing
 * else requests cold at 16.4s, both 0.4s on the next call, while every other listing answers
 * in under a second either way. The site's own page asks for twelve, so these rows show
 * twelve.
 */
export const CHAPTER_READS_SIZE = 12;

/**
 * Riding the warm line is not enough on its own: `day` goes cold again within the hour, so a
 * rebuild still has to fit inside the request or the row returns an error card while its
 * neighbours load. Given to these four calls only — the client default is right for
 * everything else, none of which has ever been seen above a second.
 */
export const CHAPTER_READS_TIMEOUT = 30_000;

/**
 * The home page's rows are all one endpoint under different `search_type` values. None of
 * them answers with a `pagination` block, so every section built on one is a single fixed
 * page and carries `viewMore: false`.
 *
 * `getRecentRead` ranks titles by views over a `search_time` window; `getRecentChapterRead`
 * ranks them by chapters opened over the same windows. Their windows overlap heavily on any
 * given day — a title that leads the week usually leads the month — but they are different
 * questions and answer differently the moment something new breaks through, so each window
 * the site offers is a row here.
 *
 * The one window that is not is `getRecentRead&search_time=week`: `getFeatured` is that
 * query reshuffled, all twelve of its titles being the weekly top twelve in another order
 * (measured again 2026-09-08, 12/12). Shipping it would be the Featured hero a second time.
 * `getLatestTable` and `getByOrigin` are likewise absent as duplicates of browse queries the
 * source already runs — see the `SORT_FIELD` note and the origin rows in `main.ts`.
 */
export const ListingType = {
  Featured: "getFeatured",
  Recommend: "getRecommend",
  Popular: "getPopular",
  Reads: "getRecentRead",
  ChapterReads: "getRecentChapterRead",
} as const;

/** The `search_time` windows both ranking types accept. */
export const Window = {
  Day: "day",
  Week: "week",
  Month: "month",
  Year: "year",
} as const;

export const PREFERENCE_NAMESPACE = "mangaball";
export const CHAPTER_LANGUAGES_KEY = "chapterLanguages";

export const PREFERENCE_DEFAULTS = {
  [CHAPTER_LANGUAGES_KEY]: ["en"] as string[],
};

export const FilterID = {
  Status: "publicationStatus",
  Demographic: "demographic",
  Origin: "originalLanguages",
  Translated: "translatedLanguage",
  TagMode: "tag_included_mode",
  Tags: "tags",
} as const;

export const SortID = {
  LatestChapters: "updated-chapters",
  RecentlyAdded: "recently-added",
  Views: "views",
  Title: "title",
} as const;

export const ListID = {
  Featured: "featured",
  Recommended: "recommended",
  Latest: "latest-updates",
  Added: "recently-added",
  Viewed: "most-viewed",
  ViewedToday: "most-viewed-today",
  ViewedMonth: "most-viewed-month",
  ViewedYear: "most-viewed-year",
  ReadToday: "most-read-today",
  ReadWeek: "most-read-week",
  ReadMonth: "most-read-month",
  ReadYear: "most-read-year",
  MangaUpdates: "manga-updates",
  Manhwa: "manhwa-updates",
  Manhua: "manhua-updates",
  Comics: "comics-updates",
  Manga: "popular-manga",
  Completed: "completed",
} as const;

export const OriginID = {
  Comics: "en",
  Manga: "jp",
  Manhwa: "kr",
  Manhua: "zh",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  {
    id: SortID.LatestChapters,
    title: "Latest Chapters",
    isDefault: true,
    isOrderable: true,
    defaultAscending: false,
  },
  {
    id: SortID.RecentlyAdded,
    title: "Recently Added",
    isOrderable: true,
    defaultAscending: false,
  },
  { id: SortID.Views, title: "Views", isOrderable: true, defaultAscending: false },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
];

/**
 * The site bakes the direction into the sort value rather than taking it separately, so
 * each option contributes a `<field>_asc` / `<field>_desc` pair. `rating_*` and
 * `updated_at_desc` are omitted: they return byte-identical listings to an unrecognised
 * sort value, which is the site falling back to its default rather than sorting.
 */
export const SORT_FIELD: Record<string, string> = {
  [SortID.LatestChapters]: "updated_chapters",
  [SortID.RecentlyAdded]: "created_at",
  [SortID.Views]: "views",
  [SortID.Title]: "name",
};

export const STATUS_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "yuri", title: "Yuri" },
  { id: "yaoi", title: "Yaoi" },
];

export const ORIGIN_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: OriginID.Manga, title: "Manga" },
  { id: OriginID.Manhwa, title: "Manhwa" },
  { id: OriginID.Manhua, title: "Manhua" },
  { id: OriginID.Comics, title: "Comics" },
];

export const TAG_MODE_OPTIONS: Option[] = [
  { id: "and", title: "Match all" },
  { id: "or", title: "Match any" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "vi", title: "Vietnamese" },
  { id: "id", title: "Indonesian" },
  { id: "pt-br", title: "Portuguese (Brazil)" },
  { id: "es", title: "Spanish" },
  { id: "es-la", title: "Spanish (Latin America)" },
  { id: "th", title: "Thai" },
  { id: "fr", title: "French" },
  { id: "ru", title: "Russian" },
  { id: "pl", title: "Polish" },
  { id: "it", title: "Italian" },
  { id: "es-419", title: "Spanish (Latin America, 419)" },
  { id: "tr", title: "Turkish" },
  { id: "zh", title: "Chinese" },
  { id: "zh-hk", title: "Chinese (Hong Kong)" },
  { id: "uk", title: "Ukrainian" },
  { id: "ar", title: "Arabic" },
  { id: "de", title: "German" },
  { id: "hu", title: "Hungarian" },
  { id: "bg", title: "Bulgarian" },
  { id: "ro", title: "Romanian" },
  { id: "fa", title: "Persian" },
  { id: "kr", title: "Korean" },
  { id: "ca", title: "Catalan" },
  { id: "hi", title: "Hindi" },
  { id: "cs", title: "Czech" },
  { id: "he", title: "Hebrew" },
  { id: "el", title: "Greek" },
  { id: "ms", title: "Malay" },
  { id: "sv", title: "Swedish" },
  { id: "nl", title: "Dutch" },
  { id: "bn", title: "Bengali" },
  { id: "sr", title: "Serbian" },
  { id: "fi", title: "Finnish" },
  { id: "da", title: "Danish" },
  { id: "no", title: "Norwegian" },
  { id: "jp", title: "Japanese" },
  { id: "ne", title: "Nepali" },
  { id: "sl", title: "Slovenian" },
  { id: "ta", title: "Tamil" },
  { id: "sk", title: "Slovak" },
  { id: "sq", title: "Albanian" },
];
export const TAG_OPTIONS: Option[] = [
  { id: "685146c5f3ed681c80f257e3", title: "Action" },
  { id: "689371f0a943baf927094f03", title: "Adult" },
  { id: "685146c5f3ed681c80f257e6", title: "Adventure" },
  { id: "685148ef15e8b86aae68e573", title: "Boys' Love" },
  { id: "685146c5f3ed681c80f257e5", title: "Comedy" },
  { id: "685148da15e8b86aae68e51f", title: "Crime" },
  { id: "685148cf15e8b86aae68e4dd", title: "Drama" },
  { id: "6892a73ba943baf927094e37", title: "Ecchi" },
  { id: "685146c5f3ed681c80f257ea", title: "Fantasy" },
  { id: "685148da15e8b86aae68e524", title: "Girls' Love" },
  { id: "685148db15e8b86aae68e527", title: "Historical" },
  { id: "685148da15e8b86aae68e520", title: "Horror" },
  { id: "685146c5f3ed681c80f257e9", title: "Isekai" },
  { id: "694cc2d9f8014f5e0a63ac73", title: "Josei(W)" },
  { id: "6851490d15e8b86aae68e5d4", title: "Magical Girls" },
  { id: "68932d11a943baf927094e7b", title: "Mature" },
  { id: "6851490c15e8b86aae68e5d2", title: "Mecha" },
  { id: "6851494e15e8b86aae68e66e", title: "Medical" },
  { id: "685148d215e8b86aae68e4f4", title: "Mystery" },
  { id: "685148e215e8b86aae68e544", title: "Philosophical" },
  { id: "685148d715e8b86aae68e507", title: "Psychological" },
  { id: "694cc2d9f8014f5e0a63ac75", title: "Revenge" },
  { id: "685148cf15e8b86aae68e4db", title: "Romance" },
  { id: "685148cf15e8b86aae68e4da", title: "Sci-Fi" },
  { id: "694cc2d9f8014f5e0a63ac74", title: "Shoujo(G)" },
  { id: "689f0ab1f2e66744c6091524", title: "Shounen Ai" },
  { id: "685148d015e8b86aae68e4e3", title: "Slice of Life" },
  { id: "689371f2a943baf927094f04", title: "Smut" },
  { id: "685148f515e8b86aae68e588", title: "Sports" },
  { id: "6851492915e8b86aae68e61c", title: "Superhero" },
  { id: "685148d915e8b86aae68e51e", title: "Thriller" },
  { id: "685148db15e8b86aae68e529", title: "Tragedy" },
  { id: "68932c3ea943baf927094e77", title: "User Created" },
  { id: "6851490715e8b86aae68e5c3", title: "Wuxia" },
  { id: "68932f68a943baf927094eaa", title: "Yaoi" },
  { id: "6896a885a943baf927094f66", title: "Yuri" },
  { id: "6a0026ba63a8d384c0a4be13", title: "3D" },
  { id: "6851490d15e8b86aae68e5d5", title: "Aliens" },
  { id: "685148e715e8b86aae68e54b", title: "Animals" },
  { id: "68bf09ff8fdeab0b6a9bc2b7", title: "Comics" },
  { id: "685148d215e8b86aae68e4f8", title: "Cooking" },
  { id: "685148df15e8b86aae68e534", title: "Crossdressing" },
  { id: "685148d915e8b86aae68e519", title: "Delinquents" },
  { id: "685146c5f3ed681c80f257e4", title: "Demons" },
  { id: "685148d715e8b86aae68e505", title: "Genderswap" },
  { id: "685148d615e8b86aae68e501", title: "Ghosts" },
  { id: "685148d015e8b86aae68e4e8", title: "Gyaru" },
  { id: "685146c5f3ed681c80f257e8", title: "Harem" },
  { id: "68bfceaf4dbc442a26519889", title: "Hentai" },
  { id: "685148f215e8b86aae68e584", title: "Incest" },
  { id: "685148d715e8b86aae68e506", title: "Loli" },
  { id: "685148d915e8b86aae68e518", title: "Mafia" },
  { id: "685148d715e8b86aae68e509", title: "Magic" },
  { id: "68f5f5ce5f29d3c1863dec3a", title: "Manhwa 18+" },
  { id: "6851490615e8b86aae68e5c2", title: "Martial Arts" },
  { id: "685148e215e8b86aae68e541", title: "Military" },
  { id: "685148db15e8b86aae68e52c", title: "Monster Girls" },
  { id: "685146c5f3ed681c80f257e2", title: "Monsters" },
  { id: "685148d015e8b86aae68e4e4", title: "Music" },
  { id: "685148d715e8b86aae68e508", title: "Ninja" },
  { id: "685148d315e8b86aae68e4fd", title: "Office Workers" },
  { id: "6851498815e8b86aae68e714", title: "Police" },
  { id: "685148e215e8b86aae68e540", title: "Post-Apocalyptic" },
  { id: "685146c5f3ed681c80f257e1", title: "Reincarnation" },
  { id: "685148df15e8b86aae68e533", title: "Reverse Harem" },
  { id: "6851490415e8b86aae68e5b9", title: "Samurai" },
  { id: "685148d015e8b86aae68e4e7", title: "School Life" },
  { id: "6a0025c263a8d384c0a4be07", title: "Seinen" },
  { id: "685148d115e8b86aae68e4ed", title: "Shota" },
  { id: "685148db15e8b86aae68e528", title: "Supernatural" },
  { id: "685148cf15e8b86aae68e4dc", title: "Survival" },
  { id: "6851490c15e8b86aae68e5d1", title: "Time Travel" },
  { id: "6851493515e8b86aae68e645", title: "Traditional Games" },
  { id: "685148f915e8b86aae68e597", title: "Vampires" },
  { id: "685148e115e8b86aae68e53c", title: "Video Games" },
  { id: "6851492115e8b86aae68e602", title: "Villainess" },
  { id: "68514a1115e8b86aae68e83e", title: "Virtual Reality" },
  { id: "6851490c15e8b86aae68e5d3", title: "Zombies" },
  { id: "685148d115e8b86aae68e4ec", title: "4-Koma" },
  { id: "685148cf15e8b86aae68e4de", title: "Adaptation" },
  { id: "685148e915e8b86aae68e558", title: "Anthology" },
  { id: "685148fe15e8b86aae68e5a7", title: "Award Winning" },
  { id: "6851490e15e8b86aae68e5da", title: "Doujinshi" },
  { id: "6851498215e8b86aae68e704", title: "Fan Colored" },
  { id: "685148d615e8b86aae68e502", title: "Full Color" },
  { id: "685148d915e8b86aae68e517", title: "Long Strip" },
  { id: "6851493515e8b86aae68e64a", title: "Official Colored" },
  { id: "685148eb15e8b86aae68e56c", title: "Oneshot" },
  { id: "6851492e15e8b86aae68e633", title: "Self-Published" },
  { id: "685148d715e8b86aae68e50d", title: "Web Comic" },
  { id: "685148d115e8b86aae68e4f3", title: "Gore" },
  { id: "685146c5f3ed681c80f257e7", title: "Sexual Violence" },
  { id: "68ecab8507ec62d87e62780f", title: "Comic" },
  { id: "68ecab1e07ec62d87e627806", title: "Manga" },
  { id: "68ecab4807ec62d87e62780b", title: "Manhua" },
  { id: "68ecab3b07ec62d87e627809", title: "Manhwa" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({
    id: FilterID.Origin,
    title: "Origin",
    subtitle: "The language the series was drawn in",
    options: ORIGIN_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Status,
    title: "Publication Status",
    options: STATUS_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Demographic,
    title: "Demographic",
    options: DEMOGRAPHIC_OPTIONS,
  }),
  SearchMultiPickerSheet({
    id: FilterID.Translated,
    title: "Translated Into",
    subtitle: "Leave empty for every language",
    options: LANGUAGE_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.TagMode,
    title: "Included Tags",
    subtitle: "How the tags below combine",
    options: TAG_MODE_OPTIONS,
  }),
];

/**
 * Excluded tags have no matching mode control: the site accepts `tag_excluded_mode` and
 * returns the same totals for `and` and `or`, so exclusion is always "drop anything
 * carrying any of these".
 */
export const TAGS_FIELD: SearchOptionField = SearchExcludableMultiPickerSheet({
  id: FilterID.Tags,
  title: "Tags",
  options: TAG_OPTIONS,
});

export const PREFERENCE_SECTIONS: PreferenceSection[] = [
  {
    header: "Chapters",
    footer:
      "A title on Manga Ball carries one chapter list per scanlation language. Only the languages selected here are listed; clear the selection to see every one.",
    fields: [
      {
        type: "multiselect",
        key: CHAPTER_LANGUAGES_KEY,
        title: "Chapter Languages",
        options: LANGUAGE_OPTIONS,
      },
    ],
  },
];

export const STATUS_BY_NAME: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  complete: PublicationStatus.COMPLETED,
  hiatus: PublicationStatus.HIATUS,
  cancelled: PublicationStatus.CANCELLED,
  canceled: PublicationStatus.CANCELLED,
};

/** The origin flag on a tile is the closest the site comes to naming a content type. */
export const CONTENT_TYPE_BY_FLAG: Record<string, ContentType> = {
  jp: ContentType.MANGA,
  kr: ContentType.MANHWA,
  cn: ContentType.MANHUA,
  zh: ContentType.MANHUA,
  gb: ContentType.COMIC,
  us: ContentType.COMIC,
};

/**
 * The site writes a few chapter languages in codes that are not ISO 639-1, and spells two
 * of them both ways at once: `kr` and `ko` are both Korean, and `es-la` and `es-419` are
 * both labelled "Spanish (Latin America)" by the site itself. Left alone, each pair splits
 * one language across two codes in the reader.
 *
 * This rewrites only what is reported. The `chapterLanguages` preference filters on the raw
 * site code before `languageOf` runs, so both spellings stay selectable.
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  jp: "ja",
  kr: "ko",
  cn: "zh",
  ib: "is",
  "es-la": "es-419",
};

export type SearchQuery = {
  page: number;
  text?: string;
  sort?: string;
  ascending?: boolean;
  status?: string;
  demographic?: string;
  origin?: string;
  translated?: readonly string[];
  tags?: readonly string[];
  excludeTags?: readonly string[];
  tagMode?: string;
};

export type ApiTitle = {
  _id?: string;
  name?: string;
  alternateName?: string;
  cover?: string;
  tags?: string;
  authors?: string;
  status?: string;
  url?: string;
  description?: string;
  last_chapter?: string;
  updated_at?: string;
  languageFlag?: string;
  isAdult?: boolean;
};

export type ApiPagination = {
  total?: number;
  limit?: number;
  current_page?: number;
  last_page?: number;
};

export type ApiSearchResponse = {
  code?: number;
  message?: string;
  data?: ApiTitle[];
  pagination?: ApiPagination;
};

/**
 * `_id` is the stable key: it is an upstream site slug (`comick`, `mangadot`, `bato`) for
 * the groups the site mirrors and a 24-hex id for user-created ones. `name` is a Pokémon
 * alias the site substitutes for the real group name, and it is not stable — one id was
 * seen under two names in a single listing — so it names the provider but never keys it.
 */
export type ApiGroup = {
  _id?: string;
  name?: string;
  icon?: string;
};

export type ApiTranslation = {
  id?: string;
  name?: string;
  language?: string;
  languageName?: string;
  group?: ApiGroup;
  date?: string;
  pages?: number;
  url?: string;
  volume?: number;
};

export type ApiChapter = {
  number?: string;
  number_float?: number;
  title?: string;
  translations?: ApiTranslation[];
};

export type ApiChapterListing = {
  code?: number;
  message?: string;
  ALL_CHAPTERS?: ApiChapter[];
  TOTAL_TRANSLATIONS?: number;
};
