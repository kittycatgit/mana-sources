import {
  ContentType,
  PublicationStatus,
  ReadingMode,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchTextField,
  SearchToggle,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://madaradex.org";
export const CDN_URL = "https://cdn.madaradex.org";
export const TITLE_ROUTE = "title";
export const POST_TYPE = "wp-manga";

export const AJAX_PATH = "/wp-admin/admin-ajax.php";

/** The `madaradex-shield` handshake that mints the token cdn.madaradex.org checks. */
export const SHIELD_ACTION = "mdx_auth_refresh";
export const SHIELD_FINGERPRINT_COOKIE = "mdx_fp";
export const SHIELD_TOKEN_COOKIE = "mdx_auth";

/** Used when the issued cookie carries no `Max-Age`; the site's own is a little over six hours. */
export const SHIELD_TOKEN_MS = 3_600_000;

/** How long a fetched title page is reused for, covering the `getContent`/`getChapters` pair. */
export const TITLE_CACHE_MS = 60_000;

export const FilterID = {
  Genres: "genres",
  MatchAllGenres: "op",
  Status: "status",
  Adult: "adult",
  Author: "author",
  Artist: "artist",
} as const;

/** `m_orderby` values, taken from the site's own sort tabs. Relevance omits the parameter. */
export const SortID = {
  Relevance: "relevance",
  Latest: "latest",
  Views: "views",
  Trending: "trending",
  Rating: "rating",
  NewManga: "new-manga",
  Alphabet: "alphabet",
} as const;

export const ListID = {
  New: "new-manga",
  Latest: "latest",
  Popular: "views",
  TopRated: "rating",
} as const;

/** The picker row meaning "do not send the parameter". */
export const ANY = "any";

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Relevance", isDefault: true, isOrderable: false },
  { id: SortID.Latest, title: "Latest Updates", isOrderable: false },
  { id: SortID.Views, title: "Most Read", isOrderable: false },
  { id: SortID.Trending, title: "Trending", isOrderable: false },
  { id: SortID.Rating, title: "Top Rated", isOrderable: false },
  { id: SortID.NewManga, title: "Newest", isOrderable: false },
  { id: SortID.Alphabet, title: "Title (A–Z)", isOrderable: false },
];

// The site's own status list also offers "upcoming", which matches nothing in the
// catalogue — a status nobody can pick their way out of is a dead filter.
export const STATUS_OPTIONS: Option[] = [
  { id: "on-going", title: "Ongoing" },
  { id: "end", title: "Completed" },
  { id: "on-hold", title: "On Hold" },
  { id: "canceled", title: "Canceled" },
];

export const ADULT_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "0", title: "Hide adult titles" },
  { id: "1", title: "Adult titles only" },
];

// The advanced-search form also carries a "Year" box (`release=`), but 2023, 2024 and 2025
// all return nothing — the install never fills the release-year field in.
export const SEARCH_FIELDS: SearchListField[] = [
  SearchToggle({
    id: FilterID.MatchAllGenres,
    title: "Match all genres",
    subtitle: "Off matches a title carrying any of them",
  }),
  SearchMultiPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
  SearchMenuPicker({ id: FilterID.Adult, title: "Adult content", options: ADULT_OPTIONS }),
  SearchTextField({ id: FilterID.Author, title: "Author", placeholder: "Author name" }),
  SearchTextField({ id: FilterID.Artist, title: "Artist", placeholder: "Artist name" }),
];

export const STATUS_BY_LABEL: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  canceled: PublicationStatus.CANCELLED,
  cancelled: PublicationStatus.CANCELLED,
  "on hold": PublicationStatus.HIATUS,
};

// There is no type field on a title; the `Tag(s)` block is the only signal there is.
export const CONTENT_TYPE_BY_TAG: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
  webtoon: ContentType.MANHWA,
};

export const READING_MODE_BY_TYPE: Record<number, ReadingMode> = {
  [ContentType.MANGA]: ReadingMode.PAGED_MANGA,
  [ContentType.MANHWA]: ReadingMode.WEBTOON,
  [ContentType.MANHUA]: ReadingMode.WEBTOON,
};

/** Genres whose presence marks a title as adult when the page carries no `adult-content`. */
export const MATURE_GENRES: readonly string[] = ["mature", "ecchi", "harem", "yuri"];

export type BrowseQuery = {
  page: number;
  query?: string;
  sort?: string;
  genres?: readonly string[];
  matchAllGenres?: boolean;
  statuses?: readonly string[];
  adult?: string;
  author?: string;
  artist?: string;
};
