import type {
  PageSection,
  PagedSearchResult,
  ResolvedPageSection,
  SearchRequest,
  SectionStyle,
} from "@mana-app/types";

export type SectionSpec = {
  id: string;
  title: string;
  subtitle?: string;
  style?: SectionStyle;
  viewMore?: boolean;
  /**
   * How many items the home page shows. `load` still returns the site's full page so the
   * view-more listing is unaffected — without this a 60-result listing becomes a 60-item
   * home row.
   */
  limit?: number;
  /**
   * Left for the app to resolve on its own instead of being fetched with the home page —
   * for a row whose load is slow enough that the whole page would wait on it.
   */
  defer?: boolean;
  load(page: number): Promise<PagedSearchResult>;
};

export function pageOf(request: { page?: number }): number {
  const page = request.page ?? 1;
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export function toPageSections(specs: readonly SectionSpec[]): PageSection[] {
  return specs.map((spec) => ({
    id: spec.id,
    title: spec.title,
    ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }),
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(spec.viewMore === false ? {} : { viewMoreLink: { request: { page: 1, listId: spec.id } } }),
  }));
}

/**
 * Every home row, fetched at once, returned already filled.
 *
 * A section returned without `items` is resolved by the app one `resolvePageSection` at
 * a time, so a page of many rows costs the sum of its rows and fills in one at a time.
 * Fetched together it costs its slowest row. A row whose request fails is returned without
 * items, so the app resolves that one on its own and its error shows on that row alone; a
 * `defer` row is returned without items on purpose, so the page is not held for it.
 */
export async function fillPageSections(specs: readonly SectionSpec[]): Promise<PageSection[]> {
  const sections = toPageSections(specs);
  const loaded = await Promise.allSettled(
    specs.map((spec) => (spec.defer ? Promise.reject(new Error("deferred")) : spec.load(1))),
  );
  return sections.map((section, index) => {
    const outcome = loaded[index];
    const spec = specs[index];
    if (!outcome || !spec || outcome.status !== "fulfilled") return section;
    const { results } = outcome.value;
    return { ...section, items: spec.limit === undefined ? results : results.slice(0, spec.limit) };
  });
}

export function sectionById(
  specs: readonly SectionSpec[],
  id: string | undefined,
): SectionSpec | undefined {
  if (!id) return undefined;
  return specs.find((spec) => spec.id === id);
}

export async function resolveSection(
  specs: readonly SectionSpec[],
  id: string,
): Promise<ResolvedPageSection> {
  const spec = sectionById(specs, id);
  if (!spec) return { items: [] };
  const { results } = await spec.load(1);
  return { items: spec.limit === undefined ? results : results.slice(0, spec.limit) };
}

export function listResults(
  specs: readonly SectionSpec[],
  request: SearchRequest,
): Promise<PagedSearchResult> | undefined {
  const spec = sectionById(specs, request.listId);
  return spec ? spec.load(pageOf(request)) : undefined;
}
