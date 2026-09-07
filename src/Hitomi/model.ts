import {
  DefinedLanguages,
  SearchMenuPicker,
  SearchPickerSheet,
  type Option,
  type SearchListField,
} from "@mana-app/types";

import type { PreferenceValue } from "./forms/index.ts";

export const BASE_URL = "https://hitomi.la";
export const LTN_URL = "https://ltn.gold-usergeneratedcontent.net";
export const TAG_INDEX_URL = "https://tagindex.hitomi.la";
export const THUMBNAIL_URL = "https://tn.gold-usergeneratedcontent.net";
export const IMAGE_DOMAIN = "gold-usergeneratedcontent.net";

// gg.js carries the path prefix and the subdomain table every full-size image URL is built
// from, and the site re-fetches it every 30 minutes. Anything longer and the URLs 404.
export const IMAGE_KEY_TTL = 20 * 60 * 1000;

export const ALL_LANGUAGES = "all";
export const ANY_TYPE = "any";
export const ANY_TAG = "any";

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

export const ListID = {
  Latest: "latest",
  English: "english",
  Doujinshi: "doujinshi",
  Manga: "manga",
  GameCG: "gamecg",
} as const;

/** One `<area>/<term>-<language>.atom` feed on ltn. No area means the site-wide index. */
export type Listing = {
  area?: string;
  term?: string;
  language: string;
};

/**
 * What a `namespace:value` term resolves to. `language` is set only by a `language:` term,
 * which names no directory of its own and narrows the index instead.
 */
export type TermTarget = {
  area?: string;
  term?: string;
  language?: string;
};

export const TYPE_OPTIONS: Option[] = [
  { id: ANY_TYPE, title: "Any type" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manga", title: "Manga" },
  { id: "artistcg", title: "Artist CG" },
  { id: "gamecg", title: "Game CG" },
  { id: "imageset", title: "Image set" },
  { id: "anime", title: "Anime" },
];

// Every one of these answers with entries — checked against `index-<language>.atom` for all
// 45 names the site's own language_support.js knows. The first ten are the site's own
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
  { id: "textless narrative", title: "Textless narrative" },
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
      subtitle: "Only applies when the search box is empty",
      options: TYPE_OPTIONS,
    }),
    SearchPickerSheet({
      id: FilterID.Language,
      title: "Language",
      subtitle: "Narrows every listing, including a term search",
      options: languages,
    }),
  ];
}

/**
 * Which feed directory a namespaced term belongs to, mirroring the site's own
 * `get_galleryids_for_query`. `female:` and `male:` stay part of the term and live under
 * `tag/`; `language:` is not a directory at all and sets the language instead.
 */
export const AREA_BY_NAMESPACE: Record<string, string> = {
  female: "tag",
  male: "tag",
  tag: "tag",
  artist: "artist",
  series: "series",
  character: "character",
  group: "group",
  type: "type",
};

/** The namespaces whose top titles seed the tag picker, in the order they are shown. */
export const TAG_NAMESPACES: readonly string[] = ["female", "male", "tag"];

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

export type GalleryFile = {
  hash: string;
  name: string;
  width?: number;
  height?: number;
};

export type GalleryTag = {
  tag: string;
  female?: string;
  male?: string;
};

export type GalleryInfo = {
  id: string;
  title: string | null;
  japanese_title: string | null;
  type: string | null;
  language: string | null;
  language_localname: string | null;
  date: string | null;
  datepublished: string | null;
  galleryurl: string | null;
  files: GalleryFile[] | null;
  tags: GalleryTag[] | null;
  artists: { artist: string }[] | null;
  groups: { group: string }[] | null;
  parodys: { parody: string }[] | null;
  characters: { character: string }[] | null;
};

/** The `[name, count, namespace]` triples `tagindex.hitomi.la` answers with. */
export type Suggestion = [string, number, string];

export type ImageKey = {
  base: string;
  fallback: number;
  subdomains: Record<number, number>;
  fetchedAt: number;
};
