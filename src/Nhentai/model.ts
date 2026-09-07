import {
  SearchExcludableMultiPickerSheet,
  SearchMenuPicker,
  SearchStepper,
  SearchTextField,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

import type { PreferenceSection, PreferenceValue } from "./forms/index.ts";

export const BASE_URL = "https://nhentai.net";
export const API_URL = `${BASE_URL}/api/v2`;

// The HTML site sits behind a Cloudflare interstitial that a plain request cannot clear;
// everything under /api/v2 answers unauthenticated and unchallenged. This source therefore
// never parses markup, which is also why it carries no cheerio.
export const PER_PAGE = 25;
export const TAG_OPTION_COUNT = 100;

// `query` has minLength 1, so a bare sort change with nothing typed still needs something
// to send. Every gallery has at least one page, making this the match-all query.
export const MATCH_ALL_QUERY = "pages:>0";

// /api/v2/cdn publishes these and they are read at runtime; these are the fallback for a
// failed config call. The two pools are NOT interchangeable — see `mediaUrl` in main.ts.
export const DEFAULT_IMAGE_SERVERS = [
  "https://i1.nhentai.net",
  "https://i2.nhentai.net",
  "https://i3.nhentai.net",
  "https://i4.nhentai.net",
];

export const DEFAULT_THUMB_SERVERS = [
  "https://t1.nhentai.net",
  "https://t2.nhentai.net",
  "https://t3.nhentai.net",
  "https://t4.nhentai.net",
];

export const ANY = "any";

// Changing this orphans every setting a reader has already saved.
export const PREFERENCE_NAMESPACE = "nhentai";

export const PreferenceID = {
  Language: "language",
} as const;

export const PREFERENCE_DEFAULTS: Record<string, PreferenceValue> = {
  [PreferenceID.Language]: ANY,
};

export const FilterID = {
  Language: "language",
  Category: "category",
  Artist: "artist",
  Parody: "parody",
  Tags: "tags",
  MinPages: "min-pages",
  MinFavorites: "min-favorites",
} as const;

// These are the API's own `sort` enum values, used verbatim as the option ids so no
// translation table is needed between the form and the request.
export const SortID = {
  Date: "date",
  Popular: "popular",
  PopularToday: "popular-today",
  PopularWeek: "popular-week",
  PopularMonth: "popular-month",
} as const;

export const ListID = {
  PopularNow: "popular-now",
  Recent: "recent",
  LanguageWeek: "language-week",
  MangaMonth: "manga-month",
} as const;

// Tag ids from /api/v2/tags/category, used by the home section that calls
// /galleries/tagged. They are stable database ids, not slugs.
export const TagID = {
  Manga: 33173,
} as const;

export const TagType = {
  Tag: "tag",
  Artist: "artist",
  Group: "group",
  Parody: "parody",
  Character: "character",
  Language: "language",
  Category: "category",
} as const;

export type LanguageSpec = {
  /** The `language:` query value, which is also the tag's slug. */
  id: string;
  title: string;
  /** How the language reads mid-sentence in section copy. */
  label: string;
  /** From /api/v2/tags/language — a stable database id, for /galleries/tagged. */
  tagId: number;
  /**
   * "Translated" is a language tag that names no language: it marks a work translated into
   * some language and co-occurs with the real one. It is worth offering as a choice —
   * a reader who wants anything they can read wants exactly that — but it can never label
   * a tile, and it reads as an adjective rather than a proper noun.
   */
  namesLanguage: boolean;
};

export const ENGLISH: LanguageSpec = {
  id: "english",
  title: "English",
  label: "English",
  tagId: 12227,
  namesLanguage: true,
};

// The API lists 14 languages, but ten of them are attached to fewer than ten galleries
// each. Offering those would be offering a choice that returns nothing.
export const LANGUAGES: readonly LanguageSpec[] = [
  ENGLISH,
  { id: "japanese", title: "Japanese", label: "Japanese", tagId: 6346, namesLanguage: true },
  { id: "chinese", title: "Chinese", label: "Chinese", tagId: 29963, namesLanguage: true },
  {
    id: "translated",
    title: "Translated",
    label: "translated",
    tagId: 17249,
    namesLanguage: false,
  },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: ANY, title: "Any language" },
  ...LANGUAGES.map(({ id, title }) => ({ id, title })),
];

// A listing entry carries `tag_ids` and no tag names, so a tile's language can only be read
// by id.
export const LANGUAGE_BY_TAG_ID: Record<number, string> = Object.fromEntries(
  LANGUAGES.filter((language) => language.namesLanguage).map(({ tagId, title }) => [tagId, title]),
);

export function languageById(id: string): LanguageSpec | undefined {
  return LANGUAGES.find((language) => language.id === id);
}

export const CATEGORY_OPTIONS: Option[] = [
  { id: ANY, title: "Any format" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manga", title: "Manga" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({
    id: FilterID.Language,
    title: "Language",
    subtitle: "Any language falls back to the one set in this source's settings",
    options: LANGUAGE_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Category,
    title: "Format",
    options: CATEGORY_OPTIONS,
  }),
  SearchTextField({
    id: FilterID.Artist,
    title: "Artist",
    subtitle: "Exact artist name as the site spells it",
    placeholder: "e.g. kojima saya",
  }),
  SearchTextField({
    id: FilterID.Parody,
    title: "Parody",
    subtitle: "The series being parodied",
    placeholder: "e.g. kantai collection",
  }),
  SearchStepper({
    id: FilterID.MinPages,
    title: "Minimum pages",
    subtitle: "0 for any length",
    lowerBound: 0,
    upperBound: 500,
    step: 5,
  }),
  SearchStepper({
    id: FilterID.MinFavorites,
    title: "Minimum favourites",
    subtitle: "0 for anything",
    lowerBound: 0,
    upperBound: 50000,
    step: 500,
  }),
];

export function tagsField(options: Option[]) {
  return SearchExcludableMultiPickerSheet({
    id: FilterID.Tags,
    title: "Tags",
    subtitle: "The 100 most used tags on the site",
    options,
  });
}

export const PREFERENCE_SECTIONS: readonly PreferenceSection[] = [
  {
    header: "Reading language",
    footer:
      "Applies to the home page, and to any search that leaves the language filter on Any language.",
    fields: [
      {
        type: "select",
        key: PreferenceID.Language,
        title: "Language",
        options: LANGUAGE_OPTIONS,
      },
    ],
  },
];

// The API takes no sort direction, so nothing here is orderable.
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Date, title: "Recently Uploaded", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Most Popular", isOrderable: false },
  { id: SortID.PopularToday, title: "Popular Today", isOrderable: false },
  { id: SortID.PopularWeek, title: "Popular This Week", isOrderable: false },
  { id: SortID.PopularMonth, title: "Popular This Month", isOrderable: false },
];

export type GalleryQuery = {
  page: number;
  query?: string;
  sort?: string;
};

export type TaggedQuery = {
  page: number;
  tagId: number;
  sort: string;
};
