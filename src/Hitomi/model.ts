import {
  DefinedLanguages,
  SearchMenuPicker,
  SearchPickerSheet,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

import type { PreferenceValue } from "./forms/index.ts";

export const BASE_URL = "https://hitomi.la";
/** Every listing, every gallery record and the image key live on this CDN, not on the site. */
export const LTN_URL = "https://ltn.gold-usergeneratedcontent.net";
export const THUMBNAIL_URL = "https://tn.gold-usergeneratedcontent.net";
export const IMAGE_DOMAIN = "gold-usergeneratedcontent.net";

// gg.js carries the path prefix and the subdomain table every full-size image URL is built
// from, and the site regenerates it daily. Anything longer and the URLs 404.
export const IMAGE_KEY_TTL = 20 * 60 * 1000;
/** The gallery index is rebuilt as galleries are added, and its name carries the version. */
export const INDEX_VERSION_TTL = 10 * 60 * 1000;

export const ALL_LANGUAGES = "all";
export const ANY_TYPE = "any";
export const ANY_TAG = "any";

/** What the site puts on a page of results, and so what one listing request asks for. */
export const PAGE_SIZE = 25;

export const FilterID = {
  Type: "type",
  Language: "language",
  Tag: "tag",
} as const;

export const PreferenceID = {
  Language: "language",
} as const;

export const PREFERENCE_DEFAULTS: Record<string, PreferenceValue> = {
  [PreferenceID.Language]: ALL_LANGUAGES,
};

export const SortID = {
  Date: "date",
  Today: "popular-today",
  Week: "popular-week",
  Month: "popular-month",
  Year: "popular-year",
} as const;

/**
 * The site's own order-by dropdown. Each order is a separate set of packed listings on the
 * CDN — `index-<language>` for date added and `popular/<window>-<language>` for the rest —
 * and every namespace has the same five under `<namespace>/popular/<window>/`.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Date, title: "Date added", isDefault: true },
  { id: SortID.Today, title: "Popular today" },
  { id: SortID.Week, title: "Popular this week" },
  { id: SortID.Month, title: "Popular this month" },
  { id: SortID.Year, title: "Popular this year" },
];

export const ListID = {
  Today: "popular-today",
  Latest: "latest",
  Week: "popular-week",
  Month: "popular-month",
  Year: "popular-year",
  Doujinshi: "doujinshi",
  Manga: "manga",
  ArtistCG: "artistcg",
  GameCG: "gamecg",
  ImageSet: "imageset",
} as const;

/** The five types the site files a gallery under, in the order its own menu lists them. */
export const TYPE_ROWS: readonly { id: string; type: string; title: string }[] = [
  { id: ListID.Doujinshi, type: "doujinshi", title: "Doujinshi" },
  { id: ListID.Manga, type: "manga", title: "Manga" },
  { id: ListID.ArtistCG, type: "artistcg", title: "Artist CG" },
  { id: ListID.GameCG, type: "gamecg", title: "Game CG" },
  { id: ListID.ImageSet, type: "imageset", title: "Image Sets" },
];

/** A term is either a word the gallery index answers or a namespace the CDN files. */
export type TermTarget =
  | { kind: "word"; term: string }
  | { kind: "area"; area: string; term: string }
  | { kind: "language"; language: string };

/**
 * Which directory of packed listings a `namespace:value` term names, mirroring the site's
 * own `get_galleryids_for_query`. `female:` and `male:` are not directories of their own —
 * the namespace stays part of the file name under `tag/` — and `language:` names no
 * directory at all, it re-scopes every other list instead.
 */
export const AREA_BY_NAMESPACE: Record<string, string> = {
  tag: "tag",
  female: "tag",
  male: "tag",
  artist: "artist",
  series: "series",
  character: "character",
  group: "group",
  type: "type",
};

export function splitTerm(value: string): TermTarget {
  const separator = value.indexOf(":");
  if (separator < 0) return { kind: "word", term: value };

  const namespace = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (namespace === "language") return { kind: "language", language: name };

  const area = AREA_BY_NAMESPACE[namespace];
  if (area === undefined || name === "") return { kind: "word", term: value };
  const term = namespace === "female" || namespace === "male" ? value : name;
  return { kind: "area", area, term };
}

/**
 * The site strips these two characters from a term before putting it in a path rather than
 * escaping them, and percent-encodes only the spaces, leaving a namespace colon as it is.
 */
function pathTerm(term: string): string {
  return term.replace(/[/#]/g, "").replace(/ /g, "%20");
}

/**
 * One packed listing on the CDN. `area` absent is the whole site; `sort` picks between the
 * date-ordered file and the four popularity windows, which are separate files rather than
 * a re-ordering of one.
 */
export function nozomiUrl(
  area: string | undefined,
  term: string | undefined,
  language: string,
  sort: string,
): string {
  const scope = encodeURIComponent(language || ALL_LANGUAGES);
  const window = sort === SortID.Date ? "" : sort.slice("popular-".length);

  if (area === undefined || term === undefined) {
    const name = window === "" ? `index-${scope}` : `popular/${window}-${scope}`;
    return `${LTN_URL}/n/${name}.nozomi`;
  }

  const name = pathTerm(term);
  const path = window === "" ? `${area}/${name}` : `${area}/popular/${window}/${name}`;
  return `${LTN_URL}/n/${path}-${scope}.nozomi`;
}

export const TYPE_OPTIONS: Option[] = [
  { id: ANY_TYPE, title: "Any type" },
  ...TYPE_ROWS.map((row) => ({ id: row.type, title: row.title })),
];

// Every one of these answers with entries — checked against `index-<language>` for all the
// names the site's own language_support.js knows. The first nine are the site's own
// popularity order; the rest follow alphabetically.
export const LANGUAGE_OPTIONS: Option[] = [
  { id: ALL_LANGUAGES, title: "All languages" },
  { id: "japanese", title: "Japanese" },
  { id: "chinese", title: "Chinese" },
  { id: "english", title: "English" },
  { id: "korean", title: "Korean" },
  { id: "spanish", title: "Spanish" },
  { id: "russian", title: "Russian" },
  { id: "portuguese", title: "Portuguese" },
  { id: "french", title: "French" },
  { id: "thai", title: "Thai" },
  { id: "albanian", title: "Albanian" },
  { id: "arabic", title: "Arabic" },
  { id: "bulgarian", title: "Bulgarian" },
  { id: "burmese", title: "Burmese" },
  { id: "catalan", title: "Catalan" },
  { id: "cebuano", title: "Cebuano" },
  { id: "czech", title: "Czech" },
  { id: "danish", title: "Danish" },
  { id: "dutch", title: "Dutch" },
  { id: "esperanto", title: "Esperanto" },
  { id: "estonian", title: "Estonian" },
  { id: "finnish", title: "Finnish" },
  { id: "german", title: "German" },
  { id: "greek", title: "Greek" },
  { id: "hebrew", title: "Hebrew" },
  { id: "hindi", title: "Hindi" },
  { id: "hungarian", title: "Hungarian" },
  { id: "icelandic", title: "Icelandic" },
  { id: "indonesian", title: "Indonesian" },
  { id: "italian", title: "Italian" },
  { id: "javanese", title: "Javanese" },
  { id: "khmer", title: "Khmer" },
  { id: "latin", title: "Latin" },
  { id: "mongolian", title: "Mongolian" },
  { id: "norwegian", title: "Norwegian" },
  { id: "persian", title: "Persian" },
  { id: "polish", title: "Polish" },
  { id: "romanian", title: "Romanian" },
  { id: "serbian", title: "Serbian" },
  { id: "slovak", title: "Slovak" },
  { id: "swedish", title: "Swedish" },
  { id: "tagalog", title: "Tagalog" },
  { id: "textless narrative", title: "Textless narrative" },
  { id: "turkish", title: "Turkish" },
  { id: "ukrainian", title: "Ukrainian" },
  { id: "vietnamese", title: "Vietnamese" },
];

export function languageTitle(id: string): string {
  return LANGUAGE_OPTIONS.find((option) => option.id === id)?.title ?? id;
}

/**
 * The first Language option means "whatever the source setting says", so it is titled with
 * the language actually in force rather than with a flat "All languages" the setting would
 * then quietly override.
 */
export function searchFields(preferred: string): SearchListField[] {
  const languages =
    preferred === ALL_LANGUAGES
      ? LANGUAGE_OPTIONS
      : [
          { id: ALL_LANGUAGES, title: `${languageTitle(preferred)} (source setting)` },
          ...LANGUAGE_OPTIONS.slice(1),
        ];

  return [
    SearchMenuPicker({
      id: FilterID.Type,
      title: "Type",
      options: TYPE_OPTIONS,
    }),
    SearchPickerSheet({
      id: FilterID.Language,
      title: "Language",
      options: languages,
    }),
  ];
}

/** The namespaces whose most-used names seed the tag picker, in the order they are shown. */
export const TAG_NAMESPACES: readonly string[] = ["female", "male", "tag"];
export const TAG_INDEX_URL = "https://tagindex.hitomi.la";

/** The `[name, count, namespace]` triples `tagindex.hitomi.la` answers with. */
export type Suggestion = [string, number, string];

export const LANGUAGE_CODES: Record<string, string> = {
  english: DefinedLanguages.ENGLISH,
  japanese: DefinedLanguages.JAPANESE,
  korean: DefinedLanguages.KOREAN,
  chinese: DefinedLanguages.CHINESE,
  french: DefinedLanguages.FRENCH,
  spanish: DefinedLanguages.SPANISH,
  portuguese: DefinedLanguages.PORTUGUESE,
  albanian: "sq",
  arabic: "ar",
  bulgarian: "bg",
  burmese: "my",
  catalan: "ca",
  cebuano: "ceb",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  esperanto: "eo",
  estonian: "et",
  finnish: "fi",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  icelandic: "is",
  indonesian: "id",
  italian: "it",
  javanese: "jv",
  khmer: "km",
  latin: "la",
  mongolian: "mn",
  norwegian: "no",
  persian: "fa",
  polish: "pl",
  romanian: "ro",
  russian: "ru",
  serbian: "sr",
  slovak: "sk",
  swedish: "sv",
  tagalog: "tl",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  vietnamese: "vi",
};

export const TYPE_TITLES: Record<string, string> = {
  doujinshi: "Doujinshi",
  manga: "Manga",
  artistcg: "Artist CG",
  gamecg: "Game CG",
  imageset: "Image set",
  anime: "Anime",
};

/**
 * A field of the gallery JSON. The site serialises each value as its database column rather
 * than as the field, so the same field is a string for one gallery and a number for the
 * next — `id` comes as `"3907438"` and as `3907438`, a tag's gender flag as `"1"` and as
 * `1`. Everything this source hands back is declared as a string, so every one of these
 * goes through `text()` before it is returned or compared.
 */
export type Text = string | number | null;

export type GalleryFile = {
  hash: Text;
  name: Text;
  width?: number;
  height?: number;
};

export type GalleryTag = {
  tag: Text;
  female?: Text;
  male?: Text;
};

export type GalleryInfo = {
  id: string | number;
  title: Text;
  japanese_title: Text;
  type: Text;
  language: Text;
  language_localname: Text;
  date: Text;
  datepublished: Text;
  galleryurl: Text;
  files: GalleryFile[] | null;
  tags: GalleryTag[] | null;
  artists: { artist: Text }[] | null;
  groups: { group: Text }[] | null;
  parodys: { parody: Text }[] | null;
  characters: { character: Text }[] | null;
};

export type ImageKey = {
  base: string;
  fallback: number;
  subdomains: Record<number, number>;
  fetchedAt: number;
};
