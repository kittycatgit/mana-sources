import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";

import { buildClient, JSON_ACCEPT } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  BASE_URL,
  BROWSE_ROUTE,
  COMIC_ROUTE,
  FilterID,
  HOME_ROUTE,
  IMAGE_BASE_URL,
  ListID,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  SORT_QUERY,
  STATUS_BY_STATE,
  SortID,
  type BrowseQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "tailspace",
  name: "Tailspace",
  version: "1.0.0",
  description: "Pulls furry comics from tailspace.com",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["tailspace.com"],
};

class TailspaceSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private tagOptions: Option[] | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 5,
      interval: 1,
      accept: JSON_ACCEPT,
      json: true,
    });
    return this.client;
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Featured,
        title: "Featured",
        style: SectionStyle.SimpleHero,
        viewMore: false,
        load: () => this.featured(),
      },
      {
        id: ListID.Updated,
        title: "Recently Updated",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.browse({ page, sort: SORT_QUERY[SortID.Updated] }),
      },
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.DetailedTripleRowPaged,
        load: (page) => this.browse({ page, sort: SORT_QUERY[SortID.Popularity] }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Tags,
        title: "Tags",
        options: await this.tags(),
      }),
      tagsHeader: "Tags",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(this.sections(), sectionID);
    if (!spec) return { items: [] };
    const { results } = await spec.load(1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return list;

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);

    return this.browse({
      page: pageOf(request),
      search: request.query?.trim() ?? "",
      sort: SORT_QUERY[resolveSortId(SORT_OPTIONS, request, SortID.Updated)] ?? "",
      categories: filters.options(FilterID.Category),
      tags: tags.included,
      excludeTags: tags.excluded,
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const comic = await this.comic(contentId);
    const artist = readRecord(comic["artist"]);
    const artistName = readString(artist["name"]);

    const tags: Tag[] = readArray(comic["tags"])
      .map(readRecord)
      .map((tag) => ({ id: readString(tag["id"]), title: readString(tag["name"]) }))
      .filter((tag) => tag.id !== "" && tag.title !== "");

    const links = artistName
      ? [
          additionalInfo.links.section({
            id: "artist",
            title: "Artist",
            items: [
              additionalInfo.links.item({
                id: artistName,
                title: artistName,
                url: `${BASE_URL}/artist/${encodeURIComponent(artistName)}`,
              }),
            ],
          }),
        ]
      : [];

    return {
      title: readString(comic["name"]) || contentId,
      cover: coverUrl(comic),
      summary: richText(comic["description"]),
      tags,
      contentType: ContentType.COMIC,
      contentRating: ContentRating.EXPLICIT,
      status:
        STATUS_BY_STATE[readString(comic["state"]).toLowerCase()] ?? PublicationStatus.ONGOING,
      webUrl: contentUrl(contentId),
      ...(links.length === 0 ? {} : { additionalInfo: links }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const comic = await this.comic(contentId);
    const count = pagesOf(comic).length;
    if (count === 0) return [];

    return [
      {
        chapterId: readString(comic["id"]) || contentId,
        number: 1,
        index: 0,
        date: readDate(comic["updated"]) ?? readDate(comic["published"]) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: count === 1 ? "1 page" : `${count} pages`,
        webUrl: contentUrl(contentId),
      },
    ];
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const comic = await this.comic(contentId);
    const comicId = readString(comic["id"]);
    const pages: ChapterPage[] = pagesOf(comic).map((page) => ({
      url: pageUrl(comicId, page),
    }));

    if (pages.length === 0) {
      throw new Error(
        `Tailspace returned no pages for "${contentId}" (chapter ${chapterId}). The comic may have been unpublished or renamed.`,
      );
    }

    return { pages };
  }

  private async featured(): Promise<PagedSearchResult> {
    const home = await this.route(`${BASE_URL}/_root.data`, HOME_ROUTE);
    const highlight = toHighlight(readRecord(home["featuredComic"]));
    return { results: highlight ? [highlight] : [], isLastPage: true };
  }

  private async browse(query: BrowseQuery): Promise<PagedSearchResult> {
    const data = await this.route(browseUrl(query), BROWSE_ROUTE);
    const results = readArray(data["comicsAndAds"])
      .map((entry) => toHighlight(readRecord(entry)))
      .filter((highlight): highlight is Highlight => highlight !== undefined);

    // `numberOfPages` here is the pagination total. The identically named field on a comic
    // is that comic's page count — they are different numbers on different payloads.
    const totalPages = readNumber(data["numberOfPages"]) ?? 1;
    return { results, isLastPage: query.page >= totalPages };
  }

  private async tags(): Promise<Option[]> {
    if (this.tagOptions) return this.tagOptions;

    const response = await this.http.get(`${BASE_URL}/api/tags`);
    const envelope = readRecord(safeParse(response.data));
    if (envelope["success"] !== true) {
      throw new Error(`Tailspace rejected the tag list request: ${readString(envelope["error"])}`);
    }

    const options = readArray(envelope["data"])
      .map(readRecord)
      .map((tag) => ({ id: readString(tag["id"]), title: readString(tag["name"]) }))
      .filter((option) => option.id !== "" && option.title !== "")
      .sort((a, b) => a.title.localeCompare(b.title));

    this.tagOptions = options;
    return options;
  }

  private async comic(contentId: string): Promise<Record<string, unknown>> {
    const data = await this.route(`${contentUrl(contentId)}.data`, COMIC_ROUTE);
    const comic = readRecord(data["comic"]);
    if (readString(comic["name"]) === "") {
      throw new Error(`Tailspace has no comic named "${contentId}".`);
    }
    return comic;
  }

  private async route(url: string, routeId: string): Promise<Record<string, unknown>> {
    const response = await this.http.get(url);
    const payload = readRecord(decodeTurboStream(response.data));
    const route = readRecord(payload[routeId]);
    const data = route["data"];
    if (data === undefined) {
      throw new Error(
        `Tailspace returned no "${routeId}" data for ${url}. The site layout may have changed.`,
      );
    }
    return readRecord(data);
  }
}

// -- turbo-stream ------------------------------------------------------------

// React Router serialises loader data as a flattened index array: entry 0 is the root, an
// object's keys and values are both indexes into that array, and a small negative set
// stands in for values JSON cannot hold. Only -5 (undefined) and -7 (null) occur in
// Tailspace payloads; the rest are mapped defensively so an unseen one cannot crash a read.
const SENTINELS: Record<number, unknown> = {
  [-1]: undefined,
  [-2]: undefined,
  [-3]: Number.NaN,
  [-4]: Number.POSITIVE_INFINITY,
  [-5]: undefined,
  [-6]: -0,
  [-7]: null,
};

function decodeTurboStream(body: string): unknown {
  const first = body.split("\n")[0] ?? "";
  const flat: unknown = safeParse(first);
  if (!Array.isArray(flat) || flat.length === 0) return undefined;

  const resolved = new Map<number, unknown>();

  const hydrate = (index: number): unknown => {
    if (index < 0) return SENTINELS[index];
    if (resolved.has(index)) return resolved.get(index);

    const value = flat[index];
    if (value === null || typeof value !== "object") {
      resolved.set(index, value);
      return value;
    }

    if (Array.isArray(value)) {
      // ["D", ms] is a Date; every other array is a list of indexes.
      if (value[0] === "D") {
        const date = new Date(readNumber(value[1]) ?? 0);
        resolved.set(index, date);
        return date;
      }
      const list: unknown[] = [];
      resolved.set(index, list);
      for (const item of value) list.push(hydrate(readNumber(item) ?? -1));
      return list;
    }

    const object: Record<string, unknown> = {};
    resolved.set(index, object);
    for (const [key, entry] of Object.entries(value)) {
      const keyIndex = Number.parseInt(key.slice(1), 10);
      const name = readString(hydrate(keyIndex));
      if (name !== "") object[name] = hydrate(readNumber(entry) ?? -1);
    }
    return object;
  };

  return hydrate(0);
}

// -- readers -----------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  return undefined;
}

// -- site shapes -------------------------------------------------------------

function contentUrl(contentId: string): string {
  return `${BASE_URL}/c/${encodeURIComponent(contentId)}`;
}

function coverUrl(comic: Record<string, unknown>): string {
  const id = readString(comic["id"]);
  if (!id) return "";
  const version = readNumber(comic["thumbnailVersion"]) ?? 0;
  return `${IMAGE_BASE_URL}/comics/${id}/thumbnail-2x.webp?v=${version}`;
}

function pagesOf(comic: Record<string, unknown>): Record<string, unknown>[] {
  return readArray(comic["pages"])
    .map(readRecord)
    .filter((page) => readString(page["token"]) !== "")
    .sort((a, b) => (readNumber(a["pageNumber"]) ?? 0) - (readNumber(b["pageNumber"]) ?? 0));
}

function pageUrl(comicId: string, page: Record<string, unknown>): string {
  // `fileType` is null for the ordinary jpg pages and carries the real extension for the
  // rest — animated pages come back as "gif" and 404 if requested as .jpg.
  const extension = readString(page["fileType"]) || "jpg";
  return `${IMAGE_BASE_URL}/comics/${comicId}/${readString(page["token"])}.${extension}`;
}

function toHighlight(entry: Record<string, unknown>): Highlight | undefined {
  // Browse results interleave promoted ads, which carry a `link` and no comic name.
  const title = readString(entry["name"]);
  if (!title) return undefined;

  const artist = readString(entry["artistName"]);
  const pages = readNumber(entry["numberOfPages"]);
  const subtitle = [artist, pages === undefined ? "" : `${pages} pages`]
    .filter(Boolean)
    .join(" · ");

  return {
    id: title,
    title,
    cover: coverUrl(entry),
    contentRating: ContentRating.EXPLICIT,
    webUrl: contentUrl(title),
    ...(subtitle === "" ? {} : { subtitle }),
  };
}

function richText(value: unknown): string {
  const document = safeParse(readString(value));
  if (document === undefined) return "";

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    const record = readRecord(node);
    const type = readString(record["type"]);
    if (type === "text") {
      parts.push(readString(record["text"]));
      return;
    }
    if (type === "hardBreak") {
      parts.push("\n");
      return;
    }
    for (const child of readArray(record["content"])) walk(child);
    if (type === "paragraph") parts.push("\n\n");
  };

  walk(document);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function browseUrl(query: BrowseQuery): string {
  const url = withQuery(`${BASE_URL}/browse.data`, {
    search: query.search,
    sort: query.sort,
    page: query.page > 1 ? query.page : undefined,
  });

  // `c`, `tag` and `excludeTag` repeat rather than taking a delimited list, which
  // `withQuery` cannot express because its input is a plain object.
  const repeated = [
    ...(query.categories ?? []).map((value) => `c=${encodeURIComponent(value)}`),
    ...(query.tags ?? []).map((value) => `tag=${encodeURIComponent(value)}`),
    ...(query.excludeTags ?? []).map((value) => `excludeTag=${encodeURIComponent(value)}`),
  ];
  if (repeated.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${repeated.join("&")}`;
}

export class Target extends TailspaceSource {}
