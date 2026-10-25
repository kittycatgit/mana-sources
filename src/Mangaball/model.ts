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

export const BASE_URL = "https://mangaball.com";
export const API_URL = `${BASE_URL}/api/v1`;

/**
 * The site's own copy of a cover lives on this host, keyed by the `image.cover.path` the API
 * reports (sometimes with backslashes, which are normalised). The host is Cloudflare
 * protected and answers a challenge to a client it does not recognise, so a cover carries the
 * MangaDex copy the API also reports wherever one exists, and this only where it does not.
 */
export const COVER_CDN = "https://bulbasaur.poke-black-and-white.net/covers/";

export const ANY = "any";

/** What the site's own search page asks for; the API honours any limit up to it. */
export const PAGE_SIZE = 24;
export const FEATURED_SIZE = 12;
export const RECOMMEND_SIZE = 18;
export const TOP_RATED_SIZE = 12;
export const TOP_CHAPTERS_SIZE = 12;
/** Several of a title's chapters rank at once, so more are asked for than the row shows. */
export const TOP_CHAPTERS_FETCH = 48;
export const TOP_CHAPTERS_TIMEOUT = 45_000;

/** The windows `chapter/top-views` ranks over. */
export const Period = {
  Day: "day",
  Week: "week",
  Month: "month",
} as const;

export const PREFERENCE_NAMESPACE = "mangaball";
export const CHAPTER_LANGUAGES_KEY = "chapterLanguages";

export const PREFERENCE_DEFAULTS = {
  [CHAPTER_LANGUAGES_KEY]: [] as string[],
};

export const FilterID = {
  Status: "status",
  Demographic: "demographic",
  Origin: "original_language",
  Translated: "chapterLanguage",
  TagMode: "tag_mode",
  Tags: "tags",
} as const;

/** Sort ids are the API's own field names. */
export const SortID = {
  LatestChapters: "latest_chapter_at",
  Updated: "updated_at",
  RecentlyAdded: "created_at",
  Views: "views",
  Rating: "rating_average",
  Title: "name",
} as const;

export const ListID = {
  Featured: "featured",
  Recommended: "recommended",
  Latest: "latest-updates",
  Added: "recently-added",
  TopRated: "top-rated",
  Viewed: "most-viewed",
  ReadToday: "most-read-today",
  ReadWeek: "most-read-week",
  ReadMonth: "most-read-month",
  Manga: "manga-updates",
  Manhwa: "manhwa-updates",
  Manhua: "manhua-updates",
  Comics: "comics-updates",
  Completed: "completed",
} as const;

/** `original_language` values; the site maps its four kinds of title onto these. */
export const OriginID = {
  Manga: "ja",
  Manhwa: "ko",
  Manhua: "zh",
  Comics: "en",
} as const;

/**
 * Ascending is offered only where it means something: the catalogue's oldest, least-viewed
 * and earliest-added tail is thousands of nameless placeholder entries, so those three sort
 * one way.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.LatestChapters, title: "Latest Chapters", isDefault: true },
  { id: SortID.Updated, title: "Recently Updated" },
  { id: SortID.RecentlyAdded, title: "Recently Added" },
  { id: SortID.Views, title: "Views" },
  { id: SortID.Rating, title: "Rating", isOrderable: true, defaultAscending: false },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
];

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

/** The site's tag ids, as its own genre index links them (96 on 2026-10-26, unchanged since 2026-09-08). */
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

/** Excluded tags always mean "drop anything carrying any of these"; the API has no mode for them. */
export const TAGS_FIELD: SearchOptionField = SearchExcludableMultiPickerSheet({
  id: FilterID.Tags,
  title: "Tags",
  options: TAG_OPTIONS,
});

export const PREFERENCE_SECTIONS: PreferenceSection[] = [
  {
    header: "Chapters",
    footer:
      "A title on Manga Ball carries one chapter list per scanlation language. Only the languages selected here are listed, and Latest Updates follows the same selection; clear it to see every one.",
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
  on_hold: PublicationStatus.HIATUS,
  cancelled: PublicationStatus.CANCELLED,
  canceled: PublicationStatus.CANCELLED,
};

/** `originalLanguage` decides the kind of title, the way the site's own front end sorts them. */
export const CONTENT_TYPE_BY_ORIGIN: Record<string, ContentType> = {
  ja: ContentType.MANGA,
  jp: ContentType.MANGA,
  ko: ContentType.MANHWA,
  kr: ContentType.MANHWA,
  zh: ContentType.MANHUA,
  cn: ContentType.MANHUA,
  "zh-hk": ContentType.MANHUA,
  "zh-hans": ContentType.MANHUA,
  "zh-hant": ContentType.MANHUA,
  en: ContentType.COMIC,
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
  adultMode?: string;
};

export type ApiCover = {
  cdn_mangadex?: string | null;
  cover?: { path?: string | null } | null;
};

export type ApiTag = {
  id?: string;
  _id?: string;
  name?: string;
  group?: string;
};

export type ApiPerson = {
  id?: string;
  _id?: string;
  name?: string;
};

export type ApiRecentChapter = {
  number?: number | string | null;
  lang?: string | null;
};

export type ApiTitle = {
  id?: string;
  _id?: string;
  name?: string;
  slug?: string;
  alternateName?: string[] | string | null;
  image?: ApiCover | null;
  description?: string[] | string | null;
  originalLanguage?: string | null;
  publicationDemographic?: string | null;
  status?: string | null;
  date_published?: number | string | null;
  tags?: ApiTag[] | null;
  authors?: ApiPerson[] | null;
  author?: ApiPerson[] | null;
  links?: Record<string, string | null | undefined> | null;
  is18plus?: boolean;
  latest_chapter?: string | number | null;
  recent_chapters?: ApiRecentChapter[] | null;
};

export type ApiPagination = {
  total?: number;
  page?: number;
  limit?: number;
  total_pages?: number;
};

export type ApiListing = {
  code?: number;
  status?: string;
  message?: string;
  data?: ApiTitle[] | null;
  pagination?: ApiPagination | null;
};

export type ApiDetail = {
  code?: number;
  status?: string;
  message?: string;
  data?: ApiTitle | null;
};

/**
 * `id` is stable; `name` is a Pokémon alias the site substitutes for the real group name
 * and has been seen changing for one id within a single listing, so it names the provider
 * but never keys it.
 */
export type ApiGroup = {
  id?: string;
  _id?: string;
  name?: string;
  slug?: string;
};

export type ApiChapter = {
  id?: string;
  _id?: string;
  lang?: string | null;
  name?: string | null;
  number?: number | string | null;
  volume?: number | null;
  created_at?: string | null;
  group?: ApiGroup | null;
};

export type ApiChapterListing = {
  status?: string;
  message?: string;
  data?: ApiChapter[] | null;
};

export type ApiTopChapter = {
  chapter_number?: string | number | null;
  title_id?: string;
  id?: string;
  name?: string;
  slug?: string;
  cover?: ApiCover | null;
  image?: ApiCover | null;
  tags?: ApiTag[] | null;
  is18plus?: boolean;
};

export type ApiTopChapters = {
  status?: string;
  data?: ApiTopChapter[] | null;
};
