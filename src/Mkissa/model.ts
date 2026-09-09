import {
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchMenuPicker,
  SearchPickerSheet,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

import type { PreferenceSection, PreferenceValue } from "./forms/index.ts";

export const BASE_URL = "https://mkissa.to";
export const API_URL = "https://api.mkissa.net/api";
export const IMAGE_BASE_URL = "https://aln.youtube-anime.com";

export const PAGE_SIZE = 26;

// The API serves at most 100 pages for any `limit`, and page 101 comes back holding page
// one's results again rather than an empty list — so an end-of-list test that only looks
// for an empty page paginates for ever over the same titles. `pageInfo.total` is no help
// either: it is always `limit * 100`, the cap rather than a count.
export const MAX_PAGE = 100;

export const TranslationType = {
  Sub: "sub",
  Raw: "raw",
} as const;

export const FilterID = {
  Genres: "genres",
  Country: "country",
  Year: "year",
} as const;

export const SortID = {
  Latest: "latest",
  Trending: "trending",
  Popular: "popular",
  Top: "top",
  Saved: "saved",
  Year: "year",
  NameAsc: "name-asc",
  NameDesc: "name-desc",
} as const;

export const ListID = {
  Trending: "trending",
  Latest: "latest",
  Popular: "popular",
  Top: "top",
  Saved: "saved",
  Manhwa: "manhwa",
  Manhua: "manhua",
} as const;

export const PREFERENCE_NAMESPACE = "mkissa";

export const PreferenceID = {
  Translation: "translation",
} as const;

export const PREFERENCE_DEFAULTS: Record<string, PreferenceValue> = {
  [PreferenceID.Translation]: TranslationType.Sub,
};

export const TRANSLATION_OPTIONS: Option[] = [
  { id: TranslationType.Sub, title: "Translated" },
  { id: TranslationType.Raw, title: "Original language (raw)" },
];

export const PREFERENCE_SECTIONS: readonly PreferenceSection[] = [
  {
    header: "Chapters",
    footer:
      "The site holds a translated and an untranslated run of many series, with different chapter counts. This picks which run every listing, title and chapter list is fetched for.",
    fields: [
      {
        type: "select",
        key: PreferenceID.Translation,
        title: "Release",
        options: TRANSLATION_OPTIONS,
      },
    ],
  },
];

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest Update", isDefault: true, isOrderable: false },
  { id: SortID.Trending, title: "Trending", isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Top, title: "Top Rated", isOrderable: false },
  { id: SortID.Saved, title: "Most Saved", isOrderable: false },
  { id: SortID.Year, title: "Release Year", isOrderable: false },
  { id: SortID.NameAsc, title: "Name (A–Z)", isOrderable: false },
  { id: SortID.NameDesc, title: "Name (Z–A)", isOrderable: false },
];

// `sortDirection` is accepted and ignored, so every sort above is fixed-direction. The
// enum also carries Recent, Random, Recommendation, Type, Boost and Trash; each of those
// returns the Latest_Update listing unchanged (Boost returns nothing at all), so shipping
// them would put the same row behind six more names.
export const SORT_BY: Record<string, string> = {
  [SortID.Latest]: "Latest_Update",
  [SortID.Trending]: "Trending",
  [SortID.Popular]: "Popular",
  [SortID.Top]: "Top",
  [SortID.Saved]: "List",
  [SortID.Year]: "Release_Year",
  [SortID.NameAsc]: "Name_ASC",
  [SortID.NameDesc]: "Name_DESC",
};

export const CountryOrigin = {
  All: "ALL",
  Japan: "JP",
  Korea: "KR",
  China: "CN",
  Other: "OTHER",
} as const;

export const COUNTRY_OPTIONS: Option[] = [
  { id: CountryOrigin.All, title: "Anywhere" },
  { id: CountryOrigin.Japan, title: "Japan (Manga)" },
  { id: CountryOrigin.Korea, title: "Korea (Manhwa)" },
  { id: CountryOrigin.China, title: "China (Manhua)" },
  { id: CountryOrigin.Other, title: "Elsewhere" },
];

// Harvested from the `genres` array of ~480 titles across every listing the site offers,
// so each one is a label the catalogue actually carries. The site's own `types` and
// `excludeTypes` facets are accepted and ignored — the Manga/Manhwa/Manhua axis is only
// filterable through `countryOrigin`.
export const GENRE_NAMES: readonly string[] = [
  "4 Koma",
  "Action",
  "Adult",
  "Adventure",
  "Boys' Love",
  "Cars",
  "Comedy",
  "Cooking",
  "Crime",
  "Crossdressing",
  "Dementia",
  "Demons",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Girls' Love",
  "Gyaru",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Loli",
  "Magic",
  "Magical Girls",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Medical",
  "Military",
  "Monster Girls",
  "Music",
  "Mystery",
  "One Shot",
  "Parody",
  "Philosophical",
  "Police",
  "Post Apocalyptic",
  "Psychological",
  "Reincarnation",
  "Reverse Harem",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shota",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Space",
  "Sports",
  "Super Power",
  "Superhero",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Tragedy",
  "Vampire",
  "Webtoons",
  "Wuxia",
  "Yaoi",
  "Youkai",
  "Yuri",
  "Zombies",
];

export const GENRE_OPTIONS: Option[] = GENRE_NAMES.map((name) => ({ id: name, title: name }));

export const FIRST_YEAR = 1960;

function yearOptions(): Option[] {
  const options: Option[] = [{ id: "", title: "Any year" }];
  for (let year = new Date().getFullYear() + 1; year >= FIRST_YEAR; year--) {
    options.push({ id: String(year), title: String(year) });
  }
  return options;
}

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({
    id: FilterID.Country,
    title: "Origin",
    options: COUNTRY_OPTIONS,
  }),
  SearchPickerSheet({
    id: FilterID.Year,
    title: "Release year",
    subtitle: "The year the series began",
    options: yearOptions(),
  }),
];

export const STATUS_BY_LABEL: Record<string, PublicationStatus> = {
  releasing: PublicationStatus.ONGOING,
  finished: PublicationStatus.COMPLETED,
  cancelled: PublicationStatus.CANCELLED,
  "not yet released": PublicationStatus.ONGOING,
};

// `translationType: "sub"` is the site's translated release; "raw" is the untranslated
// original, so its language follows the country the series came from.
export const LANGUAGE_BY_COUNTRY: Record<string, string> = {
  JP: DefinedLanguages.JAPANESE,
  KR: DefinedLanguages.KOREAN,
  CN: DefinedLanguages.CHINESE,
};

// `type` is the site's own label for the format, and it is empty far more often than not:
// across 17,000-odd distinct titles harvested from every sort and every origin it takes
// only "Manga", "Manhwa" and "Manhua", and four titles in five carry none of them —
// "Fist Demon of Mount Hua" and "Volcanic Age" are both bare. `countryOfOrigin` is the
// fallback, and it is already what a card's subtitle shows.
export const FORMAT_BY_COUNTRY: Record<string, string> = {
  JP: "Manga",
  KR: "Manhwa",
  CN: "Manhua",
};

export const CONTENT_TYPE_BY_FORMAT: Record<string, ContentType> = {
  manga: ContentType.MANGA,
  doujinshi: ContentType.MANGA,
  manhwa: ContentType.MANHWA,
  manhua: ContentType.MANHUA,
  webtoon: ContentType.COMIC,
  comic: ContentType.COMIC,
};

// Korean and Chinese webcomics are drawn as one scrolling strip; manga and doujinshi are
// paged right-to-left, and a western comic is paged the other way.
export const READING_MODE_BY_FORMAT: Record<string, ReadingMode> = {
  manga: ReadingMode.PAGED_MANGA,
  doujinshi: ReadingMode.PAGED_MANGA,
  manhwa: ReadingMode.WEBTOON,
  manhua: ReadingMode.WEBTOON,
  webtoon: ReadingMode.WEBTOON,
  comic: ReadingMode.PAGED_COMIC,
};

const CARD_FIELDS = `_id name englishName thumbnail tbObj{u} type status countryOfOrigin score availableChapters lastChapterDate`;

export const LIST_QUERY = `query($search:SearchInput,$limit:Int,$page:Int,$translationType:VaildTranslationTypeMangaEnumType,$countryOrigin:VaildCountryOriginEnumType){mangas(search:$search,limit:$limit,page:$page,translationType:$translationType,countryOrigin:$countryOrigin){edges{${CARD_FIELDS}}}}`;

export const CONTENT_QUERY = `query($_id:String!){manga(_id:$_id){${CARD_FIELDS} nativeName description banner genres authors magazine malId aniListId airedStart availableChaptersDetail}}`;

// `chapterPages` is the query the site's own reader uses and it answers AA_CRYPTO_MISSING
// to anything that has not signed the request with a key its bundle mints per deploy.
// `chaptersForRead` returns the same edges unsigned.
export const CHAPTER_READ_QUERY = `query($mangaId:String!,$translationType:VaildTranslationTypeMangaEnumType!,$chapterString:String!,$limit:Int!){chaptersForRead(mangaId:$mangaId,translationType:$translationType,chapterString:$chapterString,limit:$limit){edges{streamerId sourceName chapterString pictureUrlHead pictureUrls notes uploadDate priority}}}`;

export type BrowseQuery = {
  page: number;
  query?: string;
  sortBy: string;
  countryOrigin?: string;
  genres?: readonly string[];
  excludeGenres?: readonly string[];
  year?: number;
};
