import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchToggle,
  type Option,
  type SearchListField,
  type SearchOptionField,
} from "@mana-app/types";

export const BASE_URL = "https://e-hentai.org";
export const API_URL = "https://api.e-hentai.org/api.php";

/** A gallery page shows 20 page thumbnails, whatever the gallery's length. */
export const THUMBS_PER_PAGE = 20;

/** The toplist pager stops at 200; its jump box says so and page 201 repeats page 200. */
export const TOPLIST_PAGE_LIMIT = 200;

/** How many `/s/` pages are resolved at once when building a chapter. */
export const PAGE_BATCH = 5;

/** The id a picker uses for "no filter" — the site wants the parameter omitted. */
export const ANY = "any";

const ANY_OPTION: Option = { id: ANY, title: "Any" };

export const FilterID = {
  Categories: "categories",
  Parody: "parody",
  Tags: "tags",
  Language: "language",
  Length: "length",
  Rating: "rating",
  Torrent: "torrent",
  Expunged: "expunged",
} as const;

export const ListID = {
  Popular: "popular",
  Latest: "latest",
  TopYesterday: "top-yesterday",
  TopMonth: "top-month",
  TopAllTime: "top-all-time",
} as const;

/** `toplist.php?tl=` ids for the four gallery toplists. The 2x/3x/4x/5x ranges rank people. */
export const Toplist = {
  AllTime: 11,
  Year: 12,
  Month: 13,
  Yesterday: 15,
} as const;

export type Category = {
  id: string;
  /** Exactly as the listing row and the API print it, so it doubles as the parse key. */
  title: string;
  /** `f_cats` is a mask of the categories to *exclude*, so these bits are subtracted. */
  bit: number;
  type: ContentType;
  mode: ReadingMode;
  rating: ContentRating;
};

export const CATEGORIES: readonly Category[] = [
  {
    id: "doujinshi",
    title: "Doujinshi",
    bit: 2,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_MANGA,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "manga",
    title: "Manga",
    bit: 4,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_MANGA,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "artistcg",
    title: "Artist CG",
    bit: 8,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "gamecg",
    title: "Game CG",
    bit: 16,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "western",
    title: "Western",
    bit: 512,
    type: ContentType.COMIC,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "non-h",
    title: "Non-H",
    bit: 256,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_MANGA,
    rating: ContentRating.SUGGESTIVE,
  },
  {
    id: "imageset",
    title: "Image Set",
    bit: 32,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "cosplay",
    title: "Cosplay",
    bit: 64,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "asianporn",
    title: "Asian Porn",
    bit: 128,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
  {
    id: "misc",
    title: "Misc",
    bit: 1,
    type: ContentType.MANGA,
    mode: ReadingMode.PAGED_COMIC,
    rating: ContentRating.EXPLICIT,
  },
];

export const ALL_CATEGORY_BITS = 1023;

export const CATEGORY_OPTIONS: Option[] = CATEGORIES.map((category) => ({
  id: category.id,
  title: category.title,
}));

/**
 * The site's `language:` namespace, restricted to the values that were confirmed to return
 * results. Japanese is deliberately absent: the tag is only applied to the handful of
 * galleries that carry it explicitly, because an untagged gallery *is* Japanese.
 */
export const LANGUAGE_OPTIONS: Option[] = [
  { id: ANY, title: "Any language" },
  { id: "language:english", title: "English" },
  { id: "language:chinese", title: "Chinese" },
  { id: "language:korean", title: "Korean" },
  { id: "language:spanish", title: "Spanish" },
  { id: "language:portuguese", title: "Portuguese" },
  { id: "language:russian", title: "Russian" },
  { id: "language:french", title: "French" },
  { id: "language:german", title: "German" },
  { id: "language:italian", title: "Italian" },
  { id: "language:vietnamese", title: "Vietnamese" },
  { id: "language:thai", title: "Thai" },
  { id: "language:indonesian", title: "Indonesian" },
  { id: "language:polish", title: "Polish" },
  { id: "language:dutch", title: "Dutch" },
  { id: "language:turkish", title: "Turkish" },
  { id: "language:translated", title: "Translated (any)" },
];

export type PageRange = { from: number; to: number };

/**
 * The site answers "Your page range filter is too narrow" and returns nothing for any
 * range spanning fewer than 20 pages, so these are the ranges rather than a pair of
 * steppers the user could set to something the site refuses.
 */
export const LENGTH_RANGES: Record<string, PageRange> = {
  short: { from: 0, to: 20 },
  medium: { from: 20, to: 100 },
  long: { from: 100, to: 500 },
  epic: { from: 500, to: 9999 },
};

export const LENGTH_OPTIONS: Option[] = [
  { id: ANY, title: "Any length" },
  { id: "short", title: "Up to 20 pages" },
  { id: "medium", title: "20 to 100 pages" },
  { id: "long", title: "100 to 500 pages" },
  { id: "epic", title: "500 pages or more" },
];

export const RATING_OPTIONS: Option[] = [
  ANY_OPTION,
  { id: "2", title: "2 stars and up" },
  { id: "3", title: "3 stars and up" },
  { id: "4", title: "4 stars and up" },
  { id: "5", title: "5 stars" },
];

/**
 * The site publishes no tag index, so this vocabulary was harvested from its own listings
 * and every entry was run as a search before being kept. Tags the site filters globally
 * (`female:rape`, `female:incest`, `mixed:incest`, `male:shotacon`) return nothing for a
 * signed-out reader and are therefore not offered.
 */
const CONTENT_TAGS: readonly string[] = [
  "female:ahegao",
  "female:anal",
  "female:bbw",
  "female:big areolae",
  "female:big ass",
  "female:big breasts",
  "female:bikini",
  "female:blindfold",
  "female:blowjob",
  "female:bondage",
  "female:bunny girl",
  "female:catgirl",
  "female:cheating",
  "female:collar",
  "female:dark skin",
  "female:defloration",
  "female:elf",
  "female:femdom",
  "female:futanari",
  "female:glasses",
  "female:huge breasts",
  "female:impregnation",
  "female:kemonomimi",
  "female:lactation",
  "female:maid",
  "female:masturbation",
  "female:milf",
  "female:mind break",
  "female:nakadashi",
  "female:netorare",
  "female:nurse",
  "female:paizuri",
  "female:pantyhose",
  "female:schoolgirl uniform",
  "female:sex toys",
  "female:small breasts",
  "female:sole dickgirl",
  "female:sole female",
  "female:stockings",
  "female:swimsuit",
  "female:tomboy",
  "female:twintails",
  "female:yuri",
  "male:big penis",
  "male:crossdressing",
  "male:furry",
  "male:gender change",
  "male:males only",
  "male:muscle",
  "male:sole male",
  "male:tomgirl",
  "male:yaoi",
  "mixed:body swap",
  "mixed:ffm threesome",
  "mixed:group",
  "mixed:mmf threesome",
  "other:3d",
  "other:ai generated",
  "other:animated",
  "other:artbook",
  "other:full color",
  "other:mosaic censorship",
  "other:nudity only",
  "other:story arc",
  "other:tankoubon",
  "other:uncensored",
  "other:webtoon",
];

const PARODY_TAGS: readonly string[] = [
  "parody:arknights",
  "parody:azur lane",
  "parody:bleach",
  "parody:blue archive",
  "parody:chainsaw man",
  "parody:dragon ball",
  "parody:fate grand order",
  "parody:genshin impact",
  "parody:girls frontline",
  "parody:goddess of victory nikke",
  "parody:hololive",
  "parody:honkai star rail",
  "parody:kantai collection",
  "parody:kimetsu no yaiba",
  "parody:love live",
  "parody:my hero academia",
  "parody:naruto",
  "parody:nier automata",
  "parody:one piece",
  "parody:original",
  "parody:pokemon",
  "parody:re zero kara hajimeru isekai seikatsu",
  "parody:sousou no frieren",
  "parody:the idolmaster",
  "parody:touhou project",
  "parody:uma musume pretty derby",
  "parody:vocaloid",
  "parody:wuthering waves",
  "parody:zenless zone zero",
];

/** `namespace:name` reads back to the user the way the site's own tag chips do. */
export function tagTitle(id: string): string {
  const separator = id.indexOf(":");
  if (separator < 0) return id;
  return `${id.slice(0, separator)}: ${id.slice(separator + 1)}`;
}

function tagOptions(ids: readonly string[]): Option[] {
  return ids.map((id) => ({ id, title: tagTitle(id) }));
}

export const TAG_OPTIONS: Option[] = tagOptions(CONTENT_TAGS);
export const PARODY_OPTIONS: Option[] = tagOptions(PARODY_TAGS);

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMultiPicker({
    id: FilterID.Categories,
    title: "Categories",
    subtitle: "Leave empty to search all ten",
    options: CATEGORY_OPTIONS,
  }),
  SearchMultiPickerSheet({
    id: FilterID.Parody,
    title: "Parody",
    subtitle: "The series a gallery is drawn from",
    options: PARODY_OPTIONS,
  }),
  SearchMenuPicker({
    id: FilterID.Language,
    title: "Language",
    subtitle: "Galleries with no language tag are Japanese",
    options: LANGUAGE_OPTIONS,
  }),
  SearchMenuPicker({ id: FilterID.Length, title: "Length", options: LENGTH_OPTIONS }),
  SearchMenuPicker({ id: FilterID.Rating, title: "Minimum rating", options: RATING_OPTIONS }),
  SearchToggle({ id: FilterID.Torrent, title: "Has a torrent" }),
  SearchToggle({ id: FilterID.Expunged, title: "Expunged galleries only" }),
];

export const TAGS_FIELD: SearchOptionField = SearchExcludableMultiPickerSheet({
  id: FilterID.Tags,
  title: "Tags",
  subtitle: "Every included tag must be present; excluded ones must not",
  options: TAG_OPTIONS,
});

/** The `language:` tags the app has a code for; anything else reads as universal. */
export const LANGUAGE_CODES: Record<string, string> = {
  english: DefinedLanguages.ENGLISH,
  japanese: DefinedLanguages.JAPANESE,
  chinese: DefinedLanguages.CHINESE,
  korean: DefinedLanguages.KOREAN,
  spanish: DefinedLanguages.SPANISH,
  french: DefinedLanguages.FRENCH,
  portuguese: DefinedLanguages.PORTUGUESE,
};

export type Gallery = {
  gid: string;
  token: string;
  title: string;
  japaneseTitle: string;
  category: string;
  thumb: string;
  uploader: string;
  posted: Date | undefined;
  fileCount: number;
  fileSize: number;
  expunged: boolean;
  rating: number;
  torrentCount: number;
  tags: string[];
};

export type SearchQuery = {
  terms: string[];
  categories: string[];
  minimumRating: string;
  length: PageRange | undefined;
  requireTorrent: boolean;
  expungedOnly: boolean;
};
