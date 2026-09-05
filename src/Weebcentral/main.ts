import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type LinkItem,
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
  type SourceContext,
  type SourceInfo,
  type StaffItem,
  type Tag,
} from "@mana-app/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { HTML_ACCEPT, buildClient } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSection,
  resolveSortId,
  toPageSections,
  withQuery,
  type SectionSpec,
} from "./forms/index.ts";
import {
  ANY,
  BASE_URL,
  CONTENT_TYPE_BY_NAME,
  FilterID,
  HOT_UPDATES_URL,
  ListID,
  PAGE_SIZE,
  SEARCH_FIELDS,
  SEARCH_URL,
  SORT_OPTIONS,
  SORT_QUERY,
  STATUS_BY_NAME,
  SortID,
  TAG_OPTIONS,
  WEBTOON_TYPES,
  type SearchQuery,
} from "./model.ts";

const info: SourceInfo = {
  id: "weebcentral",
  name: "Weebcentral",
  version: "1.0.0",
  description: "Pulls manga, manhwa and manhua from weebcentral.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Demon", github: "https://github.com/kittycatgit" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["weebcentral.com"],
};

class WeebcentralSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 5,
      interval: 1,
      accept: HTML_ACCEPT,
    });
    return this.client;
  }

  private sections(adult: string): SectionSpec[] {
    return [
      {
        id: ListID.Hot,
        title: "Hot Updates",
        subtitle: "The chapters readers are on right now",
        style: SectionStyle.SimpleHero,
        limit: 10,
        load: () => this.hotUpdates(),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Series that just gained a chapter",
        style: SectionStyle.DetailedVerticalListGrouped,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.LatestUpdates, adult }),
      },
      {
        id: ListID.Popular,
        title: "Most Popular",
        subtitle: "The most-read series in the catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Popularity, adult }),
      },
      // Not "Recently Added": twelve of its first fifteen are also in Latest Updates,
      // because a series added to this site arrives with its chapters.
      {
        id: ListID.Webtoons,
        title: "Popular Webtoons",
        subtitle: "The most-read manhwa and manhua",
        style: SectionStyle.DetailedTripleRowPaged,
        limit: 15,
        load: (page) => this.browse({ page, sort: SortID.Popularity, types: WEBTOON_TYPES, adult }),
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
        subtitle: "Included tags must all match",
        options: TAG_OPTIONS,
      }),
      tagsHeader: "Tags",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections(ANY));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    return resolveSection(this.sections(adultFor(link.context)), sectionID);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const adult = adultFor(request.context);
    const list = listResults(this.sections(adult), request);
    if (list) return list;

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);

    return this.browse({
      page: pageOf(request),
      text: request.query?.trim() ?? "",
      author: filters.text(FilterID.Author),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.BestMatch),
      ascending: request.sort?.ascending ?? false,
      types: filters.options(FilterID.Type),
      statuses: filters.options(FilterID.Status),
      tags: tags.included,
      excludeTags: tags.excluded,
      official: filters.option(FilterID.Official, ANY),
      anime: filters.option(FilterID.Anime, ANY),
      // The host's rating policy wins over the filter: under a policy that forbids mature
      // content the app discards adult results anyway, so asking for them wastes a page.
      adult: adult === ANY ? filters.option(FilterID.Adult, ANY) : adult,
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.page(seriesUrl(contentId));

    const title = text($("h1").first());
    if (!title) {
      throw new Error(
        `Weebcentral returned no series page for "${contentId}". The id may be wrong or the series withdrawn.`,
      );
    }

    const tags: Tag[] = detail($, "Tag")
      .find('a[href*="included_tag="]')
      .toArray()
      .map((node) => text($(node)))
      .filter(Boolean)
      .map((name) => ({ id: name, title: name }));

    const authors = detail($, "Author")
      .find('a[href*="author="]')
      .toArray()
      .map((node) => text($(node)))
      .filter(Boolean);

    const alternatives = detail($, "Associated Name")
      .find("li")
      .toArray()
      .map((node) => text($(node)))
      .filter(Boolean);

    const summary = text(detail($, "Description").find("p"));
    const status = STATUS_BY_NAME[text(detail($, "Status").find("a")).toLowerCase()];
    const type = CONTENT_TYPE_BY_NAME[text(detail($, "Type").find("a")).toLowerCase()];
    const adult = text(detail($, "Adult Content").find("a")).toLowerCase() === "yes";
    const year = text(detail($, "Released").find("span"));

    const staff: StaffItem[] = authors.map((name) =>
      additionalInfo.staff.item({ id: name, title: name, subtitle: "Author" }),
    );

    const externals: LinkItem[] = detail($, "Track")
      .find("a[href^=http]")
      .toArray()
      .map((node) => {
        const url = $(node).attr("href") ?? "";
        return additionalInfo.links.item({ id: url, title: linkTitle(url), url });
      })
      .filter((link) => link.url !== "");

    const trackers = trackersFrom(externals);
    const sections = [
      ...(staff.length === 0
        ? []
        : [
            additionalInfo.staff.section({
              id: "authors",
              title: "Author(s)",
              hasMore: false,
              items: staff,
            }),
          ]),
      ...(externals.length === 0
        ? []
        : [
            additionalInfo.links.section({
              id: "elsewhere",
              title: "Elsewhere",
              items: externals,
            }),
          ]),
    ];

    return {
      title,
      cover: coverFor(contentId, $('meta[property="og:image"]').attr("content")),
      summary: summary || `${title}${year ? ` (${year})` : ""} on Weeb Central.`,
      tags,
      contentType: type ?? ContentType.MANGA,
      contentRating: ratingFor(adult, tags),
      recommendedPanelMode: panelModeFor(type),
      webUrl: seriesUrl(contentId),
      ...(status === undefined ? {} : { status }),
      ...(alternatives.length === 0 ? {} : { additionalTitles: alternatives }),
      ...(Object.keys(trackers).length === 0 ? {} : { trackerInfo: trackers }),
      ...(sections.length === 0 ? {} : { additionalInfo: sections }),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.page(`${seriesUrl(contentId)}/full-chapter-list`);
    const rows = $('a[href*="/chapters/"]').toArray();

    const chapters: Chapter[] = [];
    for (const node of rows) {
      const row = $(node);
      const chapterId = chapterIdFrom(row.attr("href"));
      if (!chapterId) continue;

      const title = text(row.find("span.grow > span").first()) || text(row);
      chapters.push({
        chapterId,
        title,
        number: chapterNumber(title, chapters.length + 1),
        index: chapters.length,
        date: parseDate(row.find("time").attr("datetime")) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        webUrl: chapterUrl(chapterId),
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        `Weebcentral listed no chapters for "${contentId}". The series may have been withdrawn.`,
      );
    }
    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const url = withQuery(`${chapterUrl(chapterId)}/images`, {
      is_prev: "False",
      current_page: 1,
      reading_style: "long_strip",
    });
    const $ = await this.page(url, chapterUrl(chapterId));

    const pages: ChapterPage[] = $("img[alt^=Page]")
      .toArray()
      .map((node) => absolute(imageSrc($(node))))
      .filter((page) => page !== "" && !page.includes("/static/images/"))
      .map((page) => ({ url: page }));

    if (pages.length === 0) {
      throw new Error(
        `Weebcentral returned no pages for chapter "${chapterId}" of "${contentId}". The chapter may have been pulled.`,
      );
    }
    return { pages };
  }

  private async browse(query: SearchQuery): Promise<PagedSearchResult> {
    const $ = await this.page(searchUrl(query));
    const results = highlightsFrom($, "article.bg-base-300");

    // The site paginates by offset and only tells you there is more by rendering the
    // "view more" button, so its absence is the only end-of-list signal there is.
    const hasMore = $('button[hx-get*="/search/data"]').length > 0;
    return { results, isLastPage: !hasMore || results.length === 0 };
  }

  // The site's own hot-updates page is a single unpaginated list and, unlike search, it
  // publishes nothing about a series' rating — so these tiles carry no `contentRating`.
  private async hotUpdates(): Promise<PagedSearchResult> {
    const $ = await this.page(HOT_UPDATES_URL);
    return { results: highlightsFrom($, "article"), isLastPage: true };
  }

  private async page(url: string, referer?: string): Promise<CheerioAPI> {
    const response = await this.http.get(
      url,
      referer === undefined ? undefined : { headers: { referer } },
    );
    if (!response.data) {
      throw new Error(`Weebcentral returned an empty page for ${url}.`);
    }
    return load(response.data);
  }
}

// -- parsing -----------------------------------------------------------------

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

function imageSrc(node: Cheerio<AnyNode>): string {
  const attributes = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];
  for (const attribute of attributes) {
    const value = node.attr(attribute)?.trim();
    if (!value) continue;
    const first = value.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}

function absolute(raw: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function chapterNumber(title: string, fallback: number): number {
  const marked = /#\s*(\d+(?:\.\d+)?)/.exec(title);
  if (marked?.[1]) return Number.parseFloat(marked[1]);
  const trailing = /(\d+(?:\.\d+)?)\s*$/.exec(title);
  if (trailing?.[1]) return Number.parseFloat(trailing[1]);
  return fallback;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The series page lists every field as `<li><strong>Label: </strong>…</li>`, with the
 * label wording varying ("Tags(s)", "Author(s)"), so it is matched by prefix.
 */
function detail($: CheerioAPI, label: string): Cheerio<AnyNode> {
  const match = $("li")
    .filter((_, node) => text($(node).children("strong").first()).startsWith(label))
    .first();
  return match;
}

function seriesIdFrom(href: string | undefined): string {
  return /\/series\/([0-9A-Za-z]+)/.exec(href ?? "")?.[1] ?? "";
}

function chapterIdFrom(href: string | undefined): string {
  return /\/chapters\/([0-9A-Za-z]+)/.exec(href ?? "")?.[1] ?? "";
}

function seriesUrl(contentId: string): string {
  return `${BASE_URL}/series/${encodeURIComponent(contentId)}`;
}

function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/chapters/${encodeURIComponent(chapterId)}`;
}

/**
 * Covers come from one CDN path keyed by the series id, in three sizes. Tiles rendered
 * for mobile carry the 200px `small` variant, which is a blurred cover in a hero row, so
 * every size is normalised up to `normal`.
 */
function coverFor(contentId: string, raw: string | undefined): string {
  const found = absolute(raw ?? "");
  if (found && !/\/cover\/(small|fallback)\//.test(found)) return found;
  return `https://temp.compsci88.com/cover/normal/${contentId}.webp`;
}

function ratingFor(adult: boolean, tags: readonly Tag[]): ContentRating {
  const names = tags.map((tag) => tag.title.toLowerCase());
  if (names.includes("hentai") || names.includes("smut")) return ContentRating.EXPLICIT;
  if (adult) return ContentRating.MATURE;
  if (names.includes("ecchi") || names.includes("mature")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function panelModeFor(type: ContentType | undefined): ReadingMode {
  if (type === ContentType.MANHWA || type === ContentType.MANHUA) return ReadingMode.WEBTOON;
  if (type === ContentType.MANGA) return ReadingMode.PAGED_MANGA;
  return ReadingMode.PAGED_COMIC;
}

/** Listing tiles and the series page both label their tags `Tag(s)` / `Tags(s)`. */
function tagsIn($: CheerioAPI, article: Cheerio<AnyNode>): Tag[] {
  return article
    .find("div, section")
    .filter((_, node) => text($(node).children("strong").first()).startsWith("Tag"))
    .first()
    .find("span")
    .toArray()
    .map((node) => text($(node)).replace(/,$/, "").trim())
    .filter(Boolean)
    .map((name) => ({ id: name, title: name }));
}

function linkTitle(url: string): string {
  if (url.includes("anilist.co")) return "AniList";
  if (url.includes("myanimelist.net")) return "MyAnimeList";
  if (url.includes("mangaupdates.com")) return "MangaUpdates";
  return "Official Source";
}

function trackersFrom(links: readonly LinkItem[]): Record<string, string> {
  const trackers: Record<string, string> = {};
  for (const link of links) {
    const anilist = /anilist\.co\/manga\/(\d+)/.exec(link.url)?.[1];
    if (anilist) trackers["anilist"] = anilist;
    const mal = /myanimelist\.net\/manga\/(\d+)/.exec(link.url)?.[1];
    if (mal) trackers["mal"] = mal;
  }
  return trackers;
}

/**
 * Every listing on the site renders each entry twice — once for the desktop layout and
 * once for mobile — and only one of the two carries the series link. Keying on that link
 * both identifies the entry and drops its twin.
 */
function highlightsFrom($: CheerioAPI, selector: string): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const node of $(selector).toArray()) {
    const article = $(node);
    const link = article.find('a[href*="/series/"]').first();
    const id = seriesIdFrom(link.attr("href"));
    if (!id || seen.has(id)) continue;

    const title =
      text(article.find("a.line-clamp-1").first()) ||
      article.attr("data-tip")?.trim() ||
      (article.find("img[alt$=cover]").attr("alt") ?? "").replace(/\s*cover$/, "").trim();
    if (!title) continue;

    seen.add(id);
    const subtitle = subtitleFor($, article);
    const tags = tagsIn($, article);
    const adult = article.find('[data-tip="Adult Content"]').length > 0;

    results.push({
      id,
      title,
      cover: coverFor(id, imageSrc(article.find("img").first())),
      webUrl: seriesUrl(id),
      ...(subtitle === "" ? {} : { subtitle }),
      ...(tags.length === 0 && !adult ? {} : { contentRating: ratingFor(adult, tags) }),
    });
  }

  return results;
}

/**
 * Search tiles carry Type / Status / Year as labelled rows; hot-update tiles carry the
 * chapter that just landed instead. Both read better than no subtitle at all.
 */
function subtitleFor($: CheerioAPI, article: Cheerio<AnyNode>): string {
  const chapter = text(article.find('a[href*="/chapters/"] .opacity-70 span').first());
  if (chapter) return chapter;

  const parts = ["Type", "Status", "Year"]
    .map((label) =>
      text(
        article
          .find("div")
          .filter((_, node) => text($(node).children("strong").first()).startsWith(label))
          .first()
          .find("span")
          .first(),
      ),
    )
    .filter(Boolean);
  return parts.join(" · ");
}

/**
 * `allowedContentRatings` is absent when the host sets no policy, which means "no
 * restriction" rather than "allow nothing".
 */
function adultFor(context: SourceContext | undefined): string {
  const allowed = context?.allowedContentRatings;
  if (!allowed) return ANY;
  return allowed.includes(ContentRating.MATURE) || allowed.includes(ContentRating.EXPLICIT)
    ? ANY
    : "False";
}

function searchUrl(query: SearchQuery): string {
  const url = withQuery(SEARCH_URL, {
    text: query.text,
    author: query.author,
    sort: SORT_QUERY[query.sort ?? SortID.BestMatch] ?? SORT_QUERY[SortID.BestMatch],
    order: query.ascending ? "Ascending" : "Descending",
    official: query.official,
    anime: query.anime,
    adult: query.adult,
    display_mode: "Full Display",
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  });

  // `included_type`, `included_status`, `included_tag` and `excluded_tag` repeat rather
  // than taking a delimited list, which `withQuery` cannot express from a plain object.
  const repeated = [
    ...(query.types ?? []).map((value) => `included_type=${encodeURIComponent(value)}`),
    ...(query.statuses ?? []).map((value) => `included_status=${encodeURIComponent(value)}`),
    ...(query.tags ?? []).map((value) => `included_tag=${encodeURIComponent(value)}`),
    ...(query.excludeTags ?? []).map((value) => `excluded_tag=${encodeURIComponent(value)}`),
  ];
  if (repeated.length === 0) return url;
  return `${url}&${repeated.join("&")}`;
}

export class Target extends WeebcentralSource {}
