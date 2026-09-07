import {
  ContentType,
  PublicationStatus,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchTextField,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://weebcentral.com";
export const SEARCH_URL = `${BASE_URL}/search/data`;
export const HOT_UPDATES_URL = `${BASE_URL}/hot-updates`;

// `/search/data` echoes whatever `limit` it is given but always returns 32 results and
// always advances its own "view more" button by 32, so the page size is fixed.
export const PAGE_SIZE = 32;

export const ANY = "Any";

export const FilterID = {
  Type: "included_type",
  Status: "included_status",
  Tags: "tags",
  Author: "author",
  Official: "official",
  Anime: "anime",
  Adult: "adult",
} as const;

export const SortID = {
  BestMatch: "best-match",
  Alphabet: "alphabet",
  Popularity: "popularity",
  Subscribers: "subscribers",
  RecentlyAdded: "recently-added",
  LatestUpdates: "latest-updates",
} as const;

export const ListID = {
  Hot: "hot-updates",
  Latest: "latest-updates",
  Popular: "popular",
  Webtoons: "popular-webtoons",
} as const;

export const WEBTOON_TYPES = ["Manhwa", "Manhua"] as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.BestMatch, title: "Best Match", isDefault: true, isOrderable: false },
  { id: SortID.Alphabet, title: "Alphabetical", isOrderable: true, defaultAscending: true },
  { id: SortID.Popularity, title: "Popularity", isOrderable: true, defaultAscending: false },
  { id: SortID.Subscribers, title: "Subscribers", isOrderable: true, defaultAscending: false },
  { id: SortID.RecentlyAdded, title: "Recently Added", isOrderable: true, defaultAscending: false },
  { id: SortID.LatestUpdates, title: "Latest Updates", isOrderable: true, defaultAscending: false },
];

export const SORT_QUERY: Record<string, string> = {
  [SortID.BestMatch]: "Best Match",
  [SortID.Alphabet]: "Alphabet",
  [SortID.Popularity]: "Popularity",
  [SortID.Subscribers]: "Subscribers",
  [SortID.RecentlyAdded]: "Recently Added",
  [SortID.LatestUpdates]: "Latest Updates",
};

export const TYPE_OPTIONS: Option[] = [
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "OEL", title: "OEL" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Complete", title: "Complete" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Canceled", title: "Canceled" },
];

export const TRISTATE_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "True", title: "Yes" },
  { id: "False", title: "No" },
];

// The site has no tag index to read, so this is the vocabulary its own series pages link
// to through `included_tag`. Every entry was confirmed to return results.
export const TAG_OPTIONS: Option[] = [
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Lolicon",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shotacon",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
].map((tag) => ({ id: tag, title: tag }));

export const SEARCH_FIELDS: SearchListField[] = [
  SearchTextField({
    id: FilterID.Author,
    title: "Author",
    placeholder: "Exact name, as the site spells it",
  }),
  SearchMultiPicker({
    id: FilterID.Type,
    title: "Type",
    subtitle: "Leave empty for every type",
    options: TYPE_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Status,
    title: "Status",
    subtitle: "Leave empty for every status",
    options: STATUS_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Official,
    title: "Official Translation",
    options: TRISTATE_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Anime,
    title: "Anime Adaptation",
    options: TRISTATE_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Adult,
    title: "Adult Content",
    options: TRISTATE_OPTIONS,
  }),
];

export const STATUS_BY_NAME: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  complete: PublicationStatus.COMPLETED,
  completed: PublicationStatus.COMPLETED,
  hiatus: PublicationStatus.HIATUS,
  canceled: PublicationStatus.CANCELLED,
  cancelled: PublicationStatus.CANCELLED,
};

export const CONTENT_TYPE_BY_NAME: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
  oel: ContentType.COMIC,
};

export type SearchQuery = {
  page: number;
  text?: string;
  author?: string;
  sort?: string;
  ascending?: boolean;
  types?: readonly string[];
  statuses?: readonly string[];
  tags?: readonly string[];
  excludeTags?: readonly string[];
  official?: string;
  anime?: string;
  adult?: string;
};
