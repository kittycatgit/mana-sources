import {
  ContentType,
  DefinedLanguages,
  ReadingMode,
  SearchMultiPicker,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://imhentai.xxx";

// The only route Cloudflare leaves open to an automated client. It accepts every flag the
// dedicated /popular/, /category/ and /language/ listings take, so search and all six home
// sections go through it. See recon/imhentai.md for the measured route table.
export const SEARCH_URL = `${BASE_URL}/search/`;

export const PAGE_SIZE = 20;

export const FilterID = {
  Categories: "categories",
  Languages: "languages",
} as const;

export const SortID = {
  Latest: "latest",
  Popular: "popular",
  Downloaded: "downloaded",
  TopRated: "top-rated",
} as const;

export const ListID = {
  Popular: "popular",
  Latest: "latest",
  TopRated: "top-rated",
  NewManga: "new-manga",
  NewWestern: "new-western",
  NewArtistCG: "new-artist-cg",
} as const;

/** The four mutually exclusive sort flags the site's own form submits, each 1 or 0. */
export const SORT_PARAMS: Record<string, string> = {
  [SortID.Latest]: "lt",
  [SortID.Popular]: "pp",
  [SortID.Downloaded]: "dl",
  [SortID.TopRated]: "tr",
};

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest", isDefault: true },
  { id: SortID.Popular, title: "Popular" },
  { id: SortID.Downloaded, title: "Most Downloaded" },
  { id: SortID.TopRated, title: "Top Rated" },
];

/** Option ids are the query parameter each checkbox submits. */
export const CATEGORY_OPTIONS: Option[] = [
  { id: "m", title: "Manga" },
  { id: "d", title: "Doujinshi" },
  { id: "w", title: "Western" },
  { id: "i", title: "Image Set" },
  { id: "a", title: "Artist CG" },
  { id: "g", title: "Game CG" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "jp", title: "Japanese" },
  { id: "es", title: "Spanish" },
  { id: "fr", title: "French" },
  { id: "kr", title: "Korean" },
  { id: "de", title: "German" },
  { id: "ru", title: "Russian" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMultiPicker({
    id: FilterID.Categories,
    title: "Categories",
    subtitle: "Leave empty for everything",
    options: CATEGORY_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Languages,
    title: "Languages",
    subtitle: "Leave empty for everything",
    options: LANGUAGE_OPTIONS,
  }),
];

export const CONTENT_TYPE_BY_CATEGORY: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  doujinshi: ContentType.MANGA,
  western: ContentType.COMIC,
  "image set": ContentType.COMIC,
  "artist cg": ContentType.COMIC,
  "game cg": ContentType.COMIC,
};

/** Only the two categories that are actually Japanese sequential art read right-to-left. */
export const READING_MODE_BY_CATEGORY: Record<string, ReadingMode> = {
  manga: ReadingMode.PAGED_MANGA,
  doujinshi: ReadingMode.PAGED_MANGA,
};

export const LANGUAGE_BY_NAME: Record<string, string> = {
  english: DefinedLanguages.ENGLISH,
  japanese: DefinedLanguages.JAPANESE,
  spanish: DefinedLanguages.SPANISH,
  french: DefinedLanguages.FRENCH,
  korean: DefinedLanguages.KOREAN,
  chinese: DefinedLanguages.CHINESE,
  portuguese: DefinedLanguages.PORTUGUESE,
  german: "de_DE",
  russian: "ru_RU",
};

/**
 * `g_th` encodes each page as `<type>,<width>,<height>`, and the type varies page to page
 * within one gallery — assuming a single extension 404s a fifth of some galleries.
 */
export const EXTENSION_BY_TYPE: Record<string, string> = {
  j: "jpg",
  p: "png",
  g: "gif",
  w: "webp",
};

export const SECONDS_BY_UNIT: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

/** The `ul.galleries_info` labels this source reads, matched by prefix. */
export const InfoLabel = {
  Parodies: "parodies",
  Tags: "tags",
  Artists: "artists",
  Groups: "groups",
  Languages: "languages",
  Category: "category",
} as const;

export type ListingQuery = {
  page: number;
  key?: string;
  sort?: string;
  categories?: readonly string[];
  languages?: readonly string[];
};

export type GalleryInfo = {
  fields: Record<string, { id: string; title: string }[]>;
  title: string;
  alternateTitle: string;
  cover: string;
  pageCount: number;
  posted: string;
  server: string;
  directory: string;
  loadId: string;
};
