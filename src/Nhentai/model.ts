import {
  SearchExcludableMultiPickerSheet,
  SearchMenuPicker,
  SearchStepper,
  SearchTextField,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

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
  EnglishWeek: "english-week",
  MangaMonth: "manga-month",
} as const;

// Tag ids from /api/v2/tags/language and /api/v2/tags/category, used by the home sections
// that call /galleries/tagged. They are stable database ids, not slugs.
export const TagID = {
  English: 12227,
  Manga: 33173,
} as const;

// A listing entry carries `tag_ids` and no tag names, so a tile's language can only be read
// by id. "Translated" (17249) is deliberately absent — it co-occurs with a real language
// tag and names none itself.
export const LANGUAGE_BY_TAG_ID: Record<number, string> = {
  6346: "Japanese",
  12227: "English",
  29963: "Chinese",
};

export const TagType = {
  Tag: "tag",
  Artist: "artist",
  Group: "group",
  Parody: "parody",
  Character: "character",
  Language: "language",
  Category: "category",
} as const;

// The API lists 14 languages, but ten of them are attached to fewer than ten galleries
// each. Offering those as filter rows would be offering a filter that returns nothing.
export const LANGUAGE_OPTIONS: Option[] = [
  { id: ANY, title: "Any language" },
  { id: "english", title: "English" },
  { id: "japanese", title: "Japanese" },
  { id: "chinese", title: "Chinese" },
  { id: "translated", title: "Translated" },
];

export const CATEGORY_OPTIONS: Option[] = [
  { id: ANY, title: "Any format" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manga", title: "Manga" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({
    id: FilterID.Language,
    title: "Language",
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
