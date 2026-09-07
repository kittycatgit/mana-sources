import { ContentType, PublicationStatus, ReadingMode, type Option } from "@mana-app/types";

export const BASE_URL = "https://manga18fx.com";

export const TITLE_ROUTE = "manga";
export const GENRE_ROUTE = "manga-genre";
export const POPULAR_ROUTE = "hot-manga";
export const RAW_ROUTE = "manhwa-raw";
export const SEARCH_ROUTE = "search";

export const UNCENSORED_GENRE = "uncensored-manhwa";

export const FilterID = {
  Genre: "genre",
} as const;

export const ListID = {
  Popular: "popular",
  Latest: "latest",
  Raw: "raw",
  Uncensored: "uncensored",
} as const;

export const PreferenceID = {
  HideRaw: "hideRaw",
} as const;

/** Changing this orphans every setting a reader has already saved. */
export const PREFERENCE_NAMESPACE = "manga18fx";

export const PREFERENCE_DEFAULTS: { hideRaw: boolean } = { hideRaw: false };

/**
 * A raw edition — the untranslated Korean release the site publishes beside a translated
 * title — is only distinguishable in a listing by its name. The slug carries a `-raw`
 * suffix, occasionally with a numeric disambiguator, and the heading ends in the word.
 * Over the whole 1,086-title raw archive the two together miss four titles that carry no
 * marker at all, and across 525 titles from the ordinary listings nothing that is not a
 * raw edition matches either.
 */
export const RAW_SLUG_PATTERN = /-raw(?:-\d+)?$/i;
export const RAW_TITLE_PATTERN = /[\s\-–—:([]raw[)\]]?$/i;

/** The id the genre picker uses for "no genre", which is not a route the site has. */
export const ANY = "any";

export const ANY_GENRE: Option = { id: ANY, title: "Any genre" };

/**
 * Genres the site links to from a title page but never from its own menus, so the runtime
 * harvest cannot see them. Both were confirmed to return a populated listing.
 */
export const EXTRA_GENRES: readonly Option[] = [
  { id: "adult", title: "Adult" },
  { id: "slice-of-life", title: "Slice of Life" },
];

/**
 * `getContent` and `getChapters` read the same document — the whole chapter list is inline
 * on the title page — and the app calls them back to back. A long series is around 280 KB,
 * so the second read comes out of here. The window is short enough that the only thing it
 * can hide is a chapter posted between the two calls.
 */
export const TITLE_CACHE_MS = 60_000;

// Every title on the site currently reads "Ongoing"; the rest are here so a title that
// ever says otherwise is mapped rather than silently reported as ongoing.
export const STATUS_BY_LABEL: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  updating: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  complete: PublicationStatus.COMPLETED,
  finished: PublicationStatus.COMPLETED,
  cancelled: PublicationStatus.CANCELLED,
  canceled: PublicationStatus.CANCELLED,
  dropped: PublicationStatus.CANCELLED,
  hiatus: PublicationStatus.HIATUS,
  "on hold": PublicationStatus.HIATUS,
  paused: PublicationStatus.HIATUS,
};

// The title page's own "Type" row reads Manhwa on every title, including ones filed under
// the manhua genre, so the genre tags are the only usable signal.
export const CONTENT_TYPE_BY_TAG: Record<string, ContentType> = {
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
  manga: ContentType.MANGA,
  webtoon: ContentType.MANHWA,
  comic: ContentType.COMIC,
};

export const READING_MODE_BY_TYPE: Partial<Record<ContentType, ReadingMode>> = {
  [ContentType.MANHWA]: ReadingMode.WEBTOON,
  [ContentType.MANHUA]: ReadingMode.WEBTOON,
  [ContentType.MANGA]: ReadingMode.PAGED_MANGA,
};

export type BrowseQuery = {
  page: number;
  query?: string;
  genre?: string;
};
