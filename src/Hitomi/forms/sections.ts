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
 * Every row fetched at once and returned already filled, with the empty ones dropped.
 *
 * A section returned without `items` is resolved by the app one call at a time; fetched
 * together the page costs its slowest row instead of the sum. A row whose request fails or
 * comes back with nothing is left out of the home page altogether rather than shown as an
 * empty card — the user asked for no empty rows, and a row the site could not fill today is
 * better absent than blank.
 */
export async function fillPageSections(specs: readonly SectionSpec[]): Promise<PageSection[]> {
  const loaded = await Promise.allSettled(specs.map((spec) => spec.load(1)));
  const sections: PageSection[] = [];
  toPageSections(specs).forEach((section, index) => {
    const outcome = loaded[index];
    const spec = specs[index];
    if (!outcome || !spec || outcome.status !== "fulfilled") return;
    const { results } = outcome.value;
    const items = spec.limit === undefined ? results : results.slice(0, spec.limit);
    if (items.length === 0) return;
    sections.push({ ...section, items });
  });
  return sections;
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
