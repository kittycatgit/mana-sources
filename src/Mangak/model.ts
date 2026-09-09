import {
  ContentRating,
  ContentType,
  PublicationStatus,
  ReadingMode,
  SearchGroup,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchStepper,
  type Option,
  type SearchListItem,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://mangak.io";
export const API_URL = "https://api.mangak.io";

/** What a home row and a search page ask for. `titles/search` answers 400 above 50. */
export const PAGE_SIZE = 24;

/**
 * `titles/search` refuses any page whose offset would pass this and answers 400 with
 * `context.requires_cursor`. It is the end of the list for a page-numbered client, not a
 * failure — see `isLastPage` in main.ts.
 */
export const MAX_RESULT_WINDOW = 10000;

export const ANY = "";

export const ListID = {
  Trending: "trending",
  Latest: "latest",
  Added: "added",
  Followed: "followed",
  Week: "week",
  Rated: "rated",
  Longest: "longest",
} as const;

/** Ids are the values `titles/search` takes for `sort`, so no mapping table is needed. */
export const SortID = {
  Latest: "latest",
  Newest: "newest",
  Popular: "popular",
  Views: "views",
  ViewsToday: "views_today",
  ViewsWeek: "views_7days",
  ViewsMonth: "views_30days",
  Rating: "rating",
  Chapters: "chapters",
  Comments: "comments",
} as const;

/**
 * `added_date` and `bookmarks` are in the vocabulary the API names in its own 400 and are
 * deliberately absent: `added_date` answers 500 on every request, and `bookmarks` returns
 * the identical list to `popular` in the identical order. `alphabetical` is offered by the
 * site's own sort dropdown and rejected by the API.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest Updated", isDefault: true, isOrderable: false },
  { id: SortID.Newest, title: "Recently Added", isOrderable: false },
  { id: SortID.Popular, title: "Most Followed", isOrderable: false },
  { id: SortID.Rating, title: "Highest Rated", isOrderable: false },
  { id: SortID.ViewsToday, title: "Most Viewed Today", isOrderable: false },
  { id: SortID.ViewsWeek, title: "Most Viewed This Week", isOrderable: false },
  { id: SortID.ViewsMonth, title: "Most Viewed This Month", isOrderable: false },
  { id: SortID.Views, title: "Most Viewed of All Time", isOrderable: false },
  { id: SortID.Chapters, title: "Most Chapters", isOrderable: false },
  { id: SortID.Comments, title: "Most Discussed", isOrderable: false },
];

export const FilterID = {
  Genres: "genres",
  Status: "status",
  Type: "type",
  Rating: "content-rating",
  Demographics: "demographic",
  Formats: "format",
  MinChapters: "min-chapters",
  MaxChapters: "max-chapters",
} as const;

/**
 * The site's own status dropdown also offers Hiatus and Cancelled; `titles/search` answers
 * 400 "Status must be one of: all, ongoing, completed" for both.
 */
const STATUS_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

const TYPE_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

const RATING_OPTIONS: Option[] = [
  { id: ANY, title: "Any" },
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

const FORMAT_OPTIONS: Option[] = [
  { id: "4-koma", title: "4-Koma" },
  { id: "adaptation", title: "Adaptation" },
  { id: "full-color", title: "Full Color" },
  { id: "oneshot", title: "Oneshot" },
  { id: "web-comic", title: "Web Comic" },
];

export const SEARCH_FIELDS: SearchListItem[] = [
  SearchMenuPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
  SearchMenuPicker({
    id: FilterID.Type,
    title: "Type",
    subtitle: "Where the series was published",
    options: TYPE_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Rating,
    title: "Content Rating",
    options: RATING_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Demographics,
    title: "Demographic",
    subtitle: "The audience the series was serialised for",
    options: DEMOGRAPHIC_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Formats,
    title: "Format",
    subtitle: "How the series is drawn and released",
    options: FORMAT_OPTIONS,
  }),
  SearchGroup({
    id: "chapter-count",
    title: "Chapter Count",
    children: [
      SearchStepper({ id: FilterID.MinChapters, title: "At least", lowerBound: 0, step: 10 }),
      SearchStepper({ id: FilterID.MaxChapters, title: "At most", lowerBound: 0, step: 10 }),
    ],
  }),
];

/** Listings lower-case the status; the title view capitalises it. Both are looked up here. */
export const STATUS_BY_STATE: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  hiatus: PublicationStatus.HIATUS,
  "on hold": PublicationStatus.HIATUS,
  cancelled: PublicationStatus.CANCELLED,
  canceled: PublicationStatus.CANCELLED,
  dropped: PublicationStatus.CANCELLED,
};

export const RATING_BY_NAME: Record<string, ContentRating> = {
  safe: ContentRating.SAFE,
  suggestive: ContentRating.SUGGESTIVE,
  erotica: ContentRating.MATURE,
  pornographic: ContentRating.EXPLICIT,
};

export const CONTENT_TYPE_BY_SLUG: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
};

export const READING_MODE_BY_SLUG: Record<string, ReadingMode> = {
  manga: ReadingMode.PAGED_MANGA,
  manhwa: ReadingMode.WEBTOON,
  manhua: ReadingMode.WEBTOON,
};

/**
 * A title is reachable at a bare `/<slug>`, which collides with every page the site itself
 * serves at that depth: `titles/by-slug/home` resolves to a manga called Home, so a link to
 * the site's own home page would open it. These are the first segments the site's build
 * manifest routes, so nothing under them is a slug.
 */
export const RESERVED_PATHS: readonly string[] = [
  "404",
  "500",
  "ads",
  "ads.txt",
  "auth",
  "authors",
  "bug-reports",
  "chap-preview",
  "comments",
  "community",
  "contact",
  "discussions",
  "dmca",
  "error-502",
  "feature-requests",
  "feed",
  "filters",
  "genres",
  "hall-of-fame",
  "home",
  "latest",
  "lists",
  "manga-list",
  "manga-tag",
  "manga-tags",
  "me",
  "mtl-novels",
  "newest",
  "novel-tag",
  "novel-tags",
  "official",
  "popular",
  "privacy-policy",
  "ranking",
  "read",
  "reset-password",
  "reviews",
  "robots.txt",
  "search",
  "site-settings",
  "status",
  "tags",
  "terms-of-service",
  "titles",
  "top",
  "trending",
  "updates",
  "users",
];

export type ApiParams = Record<string, string | number | undefined>;

export type SearchQuery = {
  page: number;
  keyword?: string;
  sort?: string;
  filters?: ApiParams;
};
