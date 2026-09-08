import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchGroup,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchStepper,
  type Option,
  type Provider,
  type SearchListItem,
  type SortOption,
} from "@mana-app/types";

import type { PreferenceSection, PreferenceValue } from "./forms/index.ts";

export const BASE_URL = "https://mangafire.to";
export const API_URL = `${BASE_URL}/api`;

export const PER_PAGE = 30;

/** `/titles/{hid}/chapters` rejects anything above this and answers 422. */
export const CHAPTER_PAGE_SIZE = 200;

/**
 * A ceiling on how many chapter pages one title may pull. The deepest series on the site
 * (One Piece, every language and both translation kinds) is 37 pages; the cap only exists
 * so a runaway `hasNext` cannot loop forever.
 */
export const MAX_CHAPTER_PAGES = 60;

/**
 * Every request under `/titles`, `/chapters/{id}` and `/volumes/{id}` carries a `vrf`
 * signature of its own path and query, and answers 403 "Missing token." without one. The
 * signature is three passes of a chained byte substitution: each pass maps
 * `plain ^ key[i % key.length] ^ previousCipherByte` through a 256-byte permutation and
 * feeds its own output forward, then the result is base64url with the padding dropped.
 *
 * All six tables and all three seeds are constants of the site's bundle, not of a session —
 * there is no timestamp, nonce or cookie in the input, so the same request always signs to
 * the same token. See `signature` in main.ts for the canonical string it is taken over.
 */
export type VrfStage = {
  box: string;
  key: string;
  seed: number;
};

export const VRF_STAGES: readonly VrfStage[] = [
  {
    box:
      "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWI" +
      "r/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISB" +
      "eXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMax" +
      "uouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrb" +
      "cCm4t2eCtrDgQVecJGkQ+A==",
    key: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
    seed: 90,
  },
  {
    box:
      "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLN" +
      "vwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90z" +
      "pmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD" +
      "45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq" +
      "1I1d8ar9X6Ttu5KF4fZgiA==",
    key: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
    seed: 53,
  },
  {
    box:
      "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHez" +
      "bh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUl" +
      "Db5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDj" +
      "NFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68" +
      "nTyj2T3Sshk7utqCtMi/ZQ==",
    key: "DELOJgPsVaCcblDtTGMdHzM=",
    seed: 186,
  },
];

export const ListID = {
  Trending: "trending",
  Latest: "latest",
  Viewed: "viewed",
  Added: "added",
  Rated: "rated",
} as const;

export const FilterID = {
  Types: "types",
  Statuses: "statuses",
  Ratings: "content-rating",
  Languages: "languages",
  Demographics: "demographics",
  Themes: "themes",
  GenreMode: "genres-mode",
  MinChapters: "min-chapters",
  YearFrom: "year-from",
  YearTo: "year-to",
  Genres: "genres",
} as const;

/** The API's own `order` keys, used verbatim as sort ids so nothing has to be translated. */
export const SortID = {
  Relevance: "relevance",
  Updated: "chapter_updated_at",
  Added: "created_at",
  Trending: "trending",
  ViewsWeek: "views_7d",
  ViewsMonth: "views_30d",
  ViewsTotal: "views_total",
  Follows: "follows_total",
  Score: "score",
  Title: "title",
  Year: "year",
} as const;

export const PreferenceID = {
  Language: "language",
  Translation: "translation",
} as const;

// Changing this orphans every setting a reader has already saved.
export const PREFERENCE_NAMESPACE = "mangafire";

export const ANY = "any";

/** The seven languages the site publishes chapters in, as `/titles/{hid}` reports them. */
export const LANGUAGES: readonly { id: string; title: string; code: string }[] = [
  { id: "en", title: "English", code: DefinedLanguages.ENGLISH },
  { id: "es", title: "Spanish", code: DefinedLanguages.SPANISH },
  { id: "es-la", title: "Spanish (Latin America)", code: DefinedLanguages.SPANISH },
  { id: "fr", title: "French", code: DefinedLanguages.FRENCH },
  { id: "pt", title: "Portuguese", code: DefinedLanguages.PORTUGUESE },
  { id: "pt-br", title: "Portuguese (Brazil)", code: DefinedLanguages.PORTUGUESE },
  { id: "ja", title: "Japanese", code: DefinedLanguages.JAPANESE },
];

export const LANGUAGE_OPTIONS: Option[] = LANGUAGES.map(({ id, title }) => ({ id, title }));

export const LANGUAGE_CODES: Record<string, string> = Object.fromEntries(
  LANGUAGES.map(({ id, code }) => [id, code]),
);

/**
 * The site carries the same chapter twice in one language — an official release and a fan
 * one — and `type` is the only thing telling them apart. A chapter row is `id`, `number`,
 * `name`, `language`, `type`, `createdAt` and nothing else: no group, no uploader, no team,
 * on any of the 5026 rows recon read. Its own front end has no such field either, so these
 * two are the whole of the release identity mangafire.to publishes, and neither has a site
 * of its own to link to.
 */
export const OFFICIAL_PROVIDER: Provider = { id: "official", name: "Official release" };
export const FAN_PROVIDER: Provider = { id: "unofficial", name: "Fan translation" };

export const TRANSLATION_OPTIONS: Option[] = [
  { id: ANY, title: "Official and fan translations" },
  { id: "official", title: "Official only" },
  { id: "unofficial", title: "Fan translations only" },
];

export const PREFERENCE_DEFAULTS: Record<string, PreferenceValue> = {
  [PreferenceID.Language]: "en",
  [PreferenceID.Translation]: ANY,
};

export const PREFERENCE_SECTIONS: readonly PreferenceSection[] = [
  {
    header: "Chapters",
    footer:
      "Most series here carry the same chapter in several languages, and often twice over — an official release and a fan translation. These two settings decide which of them the chapter list shows. A title that has nothing in the chosen language falls back to whatever it does have.",
    fields: [
      {
        type: "select",
        key: PreferenceID.Language,
        title: "Language",
        options: LANGUAGE_OPTIONS,
      },
      {
        type: "select",
        key: PreferenceID.Translation,
        title: "Translation",
        options: TRANSLATION_OPTIONS,
      },
    ],
  },
];

export const TYPE_OPTIONS: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "other", title: "Other" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "releasing", title: "Releasing" },
  { id: "finished", title: "Finished" },
  { id: "on_hiatus", title: "On Hiatus" },
  { id: "discontinued", title: "Discontinued" },
  { id: "not_yet_released", title: "Not Yet Released" },
];

export const RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const GENRE_MODE_OPTIONS: Option[] = [
  { id: "or", title: "Any of them" },
  { id: "and", title: "All of them" },
];

export const STATUS_BY_STATE: Record<string, PublicationStatus> = {
  releasing: PublicationStatus.ONGOING,
  finished: PublicationStatus.COMPLETED,
  on_hiatus: PublicationStatus.HIATUS,
  discontinued: PublicationStatus.CANCELLED,
  // Nothing has been published yet, so it is not on hiatus and it has not stopped.
  not_yet_released: PublicationStatus.ONGOING,
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
  other: ContentType.COMIC,
};

// Korean and Chinese webcomics are drawn as one scrolling strip; Japanese manga is not.
export const READING_MODE_BY_TYPE: Record<string, ReadingMode> = {
  manga: ReadingMode.PAGED_MANGA,
  manhwa: ReadingMode.WEBTOON,
  manhua: ReadingMode.WEBTOON,
  other: ReadingMode.PAGED_COMIC,
};

export const TYPE_LABELS: Record<string, string> = {
  manga: "Manga",
  manhwa: "Manhwa",
  manhua: "Manhua",
  other: "Other",
};

/** 0 means "leave the bound off", which is why both year fields start there. */
export const YEAR_FLOOR = 1900;
export const YEAR_CEILING = 2030;

export const SEARCH_FIELDS: SearchListItem[] = [
  SearchMultiPicker({
    id: FilterID.Types,
    title: "Type",
    options: TYPE_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Statuses,
    title: "Status",
    options: STATUS_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Ratings,
    title: "Content rating",
    options: RATING_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.Languages,
    title: "Available in",
    subtitle: "Titles carrying at least one chapter in these languages",
    options: LANGUAGE_OPTIONS,
  }),
  SearchStepper({
    id: FilterID.MinChapters,
    title: "Minimum chapters",
    subtitle: "0 for any length",
    lowerBound: 0,
    upperBound: 500,
    step: 10,
  }),
  SearchGroup({
    id: "years",
    title: "Publication year",
    children: [
      SearchStepper({
        id: FilterID.YearFrom,
        title: "From",
        subtitle: "0 for no lower bound",
        lowerBound: 0,
        upperBound: YEAR_CEILING,
        step: 1,
      }),
      SearchStepper({
        id: FilterID.YearTo,
        title: "To",
        subtitle: "0 for no upper bound",
        lowerBound: 0,
        upperBound: YEAR_CEILING,
        step: 1,
      }),
    ],
  }),
  SearchMenuPicker({
    id: FilterID.GenreMode,
    title: "Genres must match",
    options: GENRE_MODE_OPTIONS,
  }),
];

/**
 * `relevance` only ranks anything when a keyword was typed — with an empty query the API
 * falls back to catalogue order, which reads as an unsorted list. `search` swaps it for
 * Latest Update in that case, which is why it can still be the default here.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Best Match", isDefault: true, isOrderable: false },
  { id: SortID.Updated, title: "Latest Update", isOrderable: true, defaultAscending: false },
  { id: SortID.Added, title: "Recently Added", isOrderable: true, defaultAscending: false },
  { id: SortID.Trending, title: "Trending", isOrderable: false },
  { id: SortID.ViewsWeek, title: "Most Viewed · 7 days", isOrderable: false },
  { id: SortID.ViewsMonth, title: "Most Viewed · 30 days", isOrderable: false },
  { id: SortID.ViewsTotal, title: "Most Viewed · all time", isOrderable: false },
  { id: SortID.Follows, title: "Most Followed", isOrderable: false },
  { id: SortID.Score, title: "Rating", isOrderable: true, defaultAscending: false },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
  { id: SortID.Year, title: "Year", isOrderable: true, defaultAscending: false },
];

export type ApiValue = string | number | readonly (string | number)[] | Record<string, string>;
export type ApiParams = Record<string, ApiValue | undefined>;

export type TitleQuery = {
  page: number;
  sort: string;
  ascending: boolean;
  keyword?: string;
  limit?: number;
  filters?: ApiParams;
};

export type FilterGroup = {
  id: string;
  name: string;
};

export type FilterOptions = {
  genres: FilterGroup[];
  themes: FilterGroup[];
  demographics: FilterGroup[];
};
