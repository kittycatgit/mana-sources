import { int32s, readRange } from "./bytes.ts";
import { PAGE_SIZE } from "./model.ts";

/**
 * Every listing on hitomi is a `.nozomi` file: the gallery ids of that listing, packed as
 * big-endian int32 in the order the listing is read. A query is those files intersected,
 * which is exactly what the site's own search does, and a page of results is a slice of the
 * answer — so the common case is one ranged request of a hundred bytes.
 */

export type ListRef = { kind: "nozomi"; url: string } | { kind: "ids"; ids: readonly number[] };

export type IdPlan = {
  /** The list that decides the order. Read in order and never held whole. */
  driver: ListRef;
  /** Membership tests. Held whole, so the ones chosen for this are the smaller lists. */
  includes: readonly ListRef[];
  excludes: readonly ListRef[];
};

/**
 * How far a plan has been read, kept between pages so paging forward costs the next chunk
 * rather than the whole walk again.
 */
export type PlanCursor = {
  matched: number[];
  read: number;
  chunk: number;
  exhausted: boolean;
  sets: { include: Set<number>[]; exclude: Set<number>[] } | undefined;
};

/** The first read of a long walk is small so a common query pays for a hundred bytes. */
const FIRST_CHUNK = 4096;
const MAX_CHUNK = 65536;

export function newCursor(): PlanCursor {
  return { matched: [], read: 0, chunk: FIRST_CHUNK, exhausted: false, sets: undefined };
}

export function planKey(plan: IdPlan): string {
  const name = (ref: ListRef): string =>
    ref.kind === "nozomi" ? ref.url : `ids:${ref.ids.length}:${ref.ids[0] ?? ""}`;
  return [
    name(plan.driver),
    plan.includes.map(name).join(","),
    plan.excludes.map(name).join(","),
  ].join("|");
}

/** How many ids a list holds, taken from `content-range` rather than by reading it. */
export async function listLength(http: NetworkClient, ref: ListRef): Promise<number> {
  if (ref.kind === "ids") return ref.ids.length;
  const { bytes, total } = await readRange(http, ref.url, 0, 3);
  if (total !== undefined) return Math.floor(total / 4);
  return bytes.byteLength === 0 ? 0 : Number.MAX_SAFE_INTEGER;
}

async function slice(
  http: NetworkClient,
  ref: ListRef,
  from: number,
  count: number,
): Promise<{ ids: number[]; total: number | undefined }> {
  if (ref.kind === "ids") {
    return { ids: ref.ids.slice(from, from + count), total: ref.ids.length };
  }
  const { bytes, total } = await readRange(http, ref.url, from * 4, (from + count) * 4 - 1);
  return {
    ids: int32s(bytes),
    total: total === undefined ? undefined : Math.floor(total / 4),
  };
}

async function whole(http: NetworkClient, ref: ListRef): Promise<number[]> {
  if (ref.kind === "ids") return [...ref.ids];
  const { bytes } = await readRange(http, ref.url);
  return int32s(bytes);
}

export type IdPage = { ids: number[]; isLastPage: boolean };

/**
 * The ids on one page of a plan.
 *
 * A plan with nothing to intersect — every home row, and any search the site files under a
 * single name — is answered by reading the page's own hundred bytes out of the middle of
 * the file. Anything else walks the ordering list in growing chunks and stops as soon as
 * the page is full, so a common intersection still costs one read and a rare one is bounded
 * by the file rather than by how deep the reader went.
 */
export async function resolvePage(
  http: NetworkClient,
  plan: IdPlan,
  page: number,
  cursor: PlanCursor,
): Promise<IdPage> {
  const from = (page - 1) * PAGE_SIZE;
  const wanted = from + PAGE_SIZE;

  if (plan.includes.length === 0 && plan.excludes.length === 0) {
    const { ids, total } = await slice(http, plan.driver, from, PAGE_SIZE);
    const isLastPage =
      total === undefined ? ids.length < PAGE_SIZE : from + ids.length >= Math.max(total, 0);
    return { ids, isLastPage };
  }

  if (cursor.sets === undefined) {
    const [include, exclude] = await Promise.all([
      Promise.all(plan.includes.map((ref) => whole(http, ref).then((ids) => new Set(ids)))),
      Promise.all(plan.excludes.map((ref) => whole(http, ref).then((ids) => new Set(ids)))),
    ]);
    cursor.sets = { include, exclude };
  }
  const { include, exclude } = cursor.sets;

  // One more than the page needs, so a full page knows whether another follows.
  while (cursor.matched.length <= wanted && !cursor.exhausted) {
    const { ids, total } = await slice(http, plan.driver, cursor.read, cursor.chunk);
    cursor.read += ids.length;
    cursor.exhausted =
      ids.length < cursor.chunk || (total !== undefined && cursor.read >= Math.max(total, 0));
    cursor.chunk = Math.min(cursor.chunk * 2, MAX_CHUNK);

    for (const id of ids) {
      if (!include.every((set) => set.has(id))) continue;
      if (exclude.some((set) => set.has(id))) continue;
      cursor.matched.push(id);
    }
  }

  return {
    ids: cursor.matched.slice(from, wanted),
    isLastPage: cursor.exhausted && cursor.matched.length <= wanted,
  };
}
