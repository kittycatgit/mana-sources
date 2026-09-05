import {
  ContentRating,
  ContentType,
  PublicationStatus,
  ReadingMode,
  SearchMenuPicker,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://hiperdex.com";
export const API_URL = `${BASE_URL}/api/trpc`;

// Every /api/trpc call answers 401 without this cookie, and the server only mints it in
// the Set-Cookie of a plain document request — the site's own JavaScript never sets it.
export const SESSION_COOKIE = "__st";

// `reader.chapterPages` — alone among the procedures — validates this header, answering
// 403 "Use o aplicativo oficial em hiperdex.tv" without it. Every other endpoint ignores
// it, including when it is wrong, so it is sent on all of them. The value is a per-deploy
// constant the site's own bundle assembles from a char-code array and a base64 literal;
// when it rotates, `discoverApiKey` re-reads it from the live bundle.
export const API_KEY_HEADER = "x-cfg-auth";
export const API_KEY = "yceqt7qgu004";

export const Procedure = {
  Genres: "search.genres",
  Search: "search.query",
  Trending: "recommendations.trending",
  LatestChapters: "recommendations.latestChapters",
  Series: "series.bySlugWithGenres",
  SeriesSummary: "series.bySlug",
  Chapters: "series.chapters",
  Pages: "reader.chapterPages",
} as const;

export const FilterID = {
  Type: "type",
  Status: "status",
  Rating: "rating",
  Genres: "genres",
} as const;

export const SortID = {
  Relevance: "relevance",
  Popular: "popular",
  Score: "score",
  Recent: "recent",
  Newest: "newest",
  Oldest: "oldest",
  Alphabetical: "alphabetical",
} as const;

export const ListID = {
  Trending: "trending",
  Latest: "latest",
  Popular: "popular",
  TopRated: "top-rated",
  Added: "recently-added",
} as const;

export const SEARCH_PAGE_SIZE = 30;
export const TRENDING_PAGE_SIZE = 20;
export const LATEST_PAGE_SIZE = 40;

/** The id a picker uses for "no filter" — the API has no such value and wants the key omitted. */
export const ANY = "any";

const ANY_OPTION: Option = { id: ANY, title: "Any" };

// The site's own filter panel also lists novel, webtoon and one_shot, but every one of
// them returns totalHits: 0 — offering them would be offering a dead filter.
export const TYPE_OPTIONS: Option[] = [
  ANY_OPTION,
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

// "releasing" is missing from the site's own status filter, yet 284 titles carry it and
// "ongoing" does not match them. Dropping it would hide those titles behind every status.
export const STATUS_OPTIONS: Option[] = [
  ANY_OPTION,
  { id: "ongoing", title: "Ongoing" },
  { id: "releasing", title: "Releasing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const RATING_OPTIONS: Option[] = [
  ANY_OPTION,
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({ id: FilterID.Type, title: "Type", options: TYPE_OPTIONS }),
  SearchMenuPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
  SearchMenuPicker({ id: FilterID.Rating, title: "Rating", options: RATING_OPTIONS }),
];

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Relevance", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Most Popular", isOrderable: false },
  { id: SortID.Score, title: "Highest Rated", isOrderable: false },
  { id: SortID.Recent, title: "Recently Updated", isOrderable: false },
  { id: SortID.Newest, title: "Newest", isOrderable: false },
  { id: SortID.Oldest, title: "Oldest", isOrderable: false },
  { id: SortID.Alphabetical, title: "Title (A–Z)", isOrderable: false },
];

export const STATUS_BY_STATE: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  releasing: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  hiatus: PublicationStatus.HIATUS,
  cancelled: PublicationStatus.CANCELLED,
};

export const RATING_BY_NAME: Record<string, ContentRating> = {
  safe: ContentRating.SAFE,
  suggestive: ContentRating.SUGGESTIVE,
  erotica: ContentRating.MATURE,
  pornographic: ContentRating.EXPLICIT,
};

export const CONTENT_TYPE_BY_NAME: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
  webtoon: ContentType.MANHWA,
  one_shot: ContentType.MANGA,
  novel: ContentType.NOVEL,
};

// Korean and Chinese titles here are vertical scrolls; Japanese ones are right-to-left pages.
export const READING_MODE_BY_TYPE: Record<string, ReadingMode> = {
  manga: ReadingMode.PAGED_MANGA,
  manhwa: ReadingMode.WEBTOON,
  manhua: ReadingMode.WEBTOON,
  webtoon: ReadingMode.WEBTOON,
};

/** `maxRating` is a ceiling, so this is the order the host's allowed ratings are reduced by. */
export const RATING_CEILING: readonly { rating: ContentRating; name: string }[] = [
  { rating: ContentRating.SAFE, name: "safe" },
  { rating: ContentRating.SUGGESTIVE, name: "suggestive" },
  { rating: ContentRating.MATURE, name: "erotica" },
  { rating: ContentRating.EXPLICIT, name: "pornographic" },
];

export type SearchQuery = {
  page: number;
  query?: string;
  sort?: string;
  type?: string;
  status?: string;
  rating?: string;
  genres?: readonly string[];
  maxRating: string;
};
