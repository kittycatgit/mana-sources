import type { WebViewPageInstance } from "@mana-app/types";

import { BASE_URL, LTN_URL } from "./model.ts";

/**
 * The site's own search, run inside an auxiliary WebView.
 *
 * `search.js` resolves a query against `galleriesindex` — a B-tree keyed by the first four
 * bytes of each term's SHA-256, whose leaves are runs of big-endian int32 gallery ids — and
 * every namespaced term against a `.nozomi` file of the same ints. Both are raw bytes, and
 * `NetworkResponse.data` is a string, so they reach a source UTF-8 replaced and beyond
 * recovery. A WKWebView opened on hitomi.la reads them as bytes, and the CDN issues that
 * origin the CORS grant with `Range` in `access-control-allow-headers` the descent needs.
 */

/** How many ids cross the bridge. A common tag matches six figures; 40 pages is plenty. */
const ID_LIMIT = 1000;

type PageResponse = {
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** The page's own globals, which the source's own lib does not declare. */
type PageGlobals = {
  fetch(url: string, init?: { headers: Record<string, string> }): Promise<PageResponse>;
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(input: string): Uint8Array };
};

/**
 * The gallery ids a query matches, newest first, or `undefined` when the WebView route is
 * unavailable — which is the caller's signal to fall back rather than report no results.
 */
export async function searchIndexIds(
  query: string,
  language: string,
): Promise<string[] | undefined> {
  let page: WebViewPageInstance | undefined;
  try {
    page = await WebViewPage.create();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const ids = await page.evaluate<number[], [string, string, string, number]>(
      runIndexSearch,
      query,
      language,
      LTN_URL,
      ID_LIMIT,
    );
    return ids.map((id) => String(id));
  } catch {
    return undefined;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/**
 * Runs in the page, so it reaches nothing outside itself and everything it returns is JSON.
 * It mirrors `do_search` in the site's `results.js`: namespaced terms seed the result set
 * because their feed is already ordered and language-scoped, the remaining terms narrow it,
 * and a `-term` removes what it matches.
 */
async function runIndexSearch(
  query: string,
  language: string,
  ltn: string,
  limit: number,
): Promise<number[]> {
  /** Every B-tree node is padded to this, and carries one more child than it has keys. */
  const NODE_SIZE = 464;
  const BRANCHES = 17;
  /** A 16-way tree over the site's terms is six deep; the bound only stops a cycle. */
  const MAX_DEPTH = 24;

  const web = globalThis as unknown as PageGlobals;

  let versionRequest: Promise<string> | undefined;

  function indexVersion(): Promise<string> {
    if (versionRequest === undefined) {
      versionRequest = web
        .fetch(`${ltn}/galleriesindex/version?_=${Date.now()}`)
        .then((response) => response.text())
        .then((text) => text.trim());
    }
    return versionRequest;
  }

  async function bytes(
    url: string,
    first?: number,
    last?: number,
  ): Promise<Uint8Array | undefined> {
    const response = await (first === undefined
      ? web.fetch(url)
      : web.fetch(url, { headers: { Range: `bytes=${first}-${last}` } }));
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  }

  function intsOf(raw: Uint8Array, offset: number, count: number): number[] {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const ids: number[] = [];
    for (let index = 0; index < count; index++) ids.push(view.getInt32(offset + index * 4, false));
    return ids;
  }

  async function nozomiIds(area: string, tag: string, lang: string): Promise<number[]> {
    // The site strips these two characters from a term rather than escaping them, and its
    // XHR percent-encodes the spaces a tag name carries but leaves the namespace colon.
    const name = tag.replace(/[/#]/g, "").replace(/ /g, "%20");
    const path = area === "all" ? `${name}-${lang}` : `${area}/${name}-${lang}`;
    const raw = await bytes(`${ltn}/n/${path}.nozomi`);
    return raw === undefined ? [] : intsOf(raw, 0, Math.floor(raw.byteLength / 4));
  }

  async function leafIds(version: string, offset: number, length: number): Promise<number[]> {
    if (length <= 0) return [];
    const raw = await bytes(
      `${ltn}/galleriesindex/galleries.${version}.data`,
      offset,
      offset + length - 1,
    );
    if (raw === undefined) return [];
    const count = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, false);
    // A run that does not fill its own span is a version that rolled under the descent.
    if (count <= 0 || raw.byteLength !== count * 4 + 4) return [];
    return intsOf(raw, 4, count);
  }

  async function indexIds(term: string): Promise<number[]> {
    const version = await indexVersion();
    const digest = await web.crypto.subtle.digest("SHA-256", new web.TextEncoder().encode(term));
    const key = new Uint8Array(digest).slice(0, 4);

    let address = 0;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const raw = await bytes(
        `${ltn}/galleriesindex/galleries.${version}.index`,
        address,
        address + NODE_SIZE - 1,
      );
      if (raw === undefined) return [];
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

      let at = 0;
      const keys: Uint8Array[] = [];
      const keyCount = view.getInt32(at, false);
      at += 4;
      for (let index = 0; index < keyCount; index++) {
        const size = view.getInt32(at, false);
        at += 4;
        keys.push(raw.slice(at, at + size));
        at += size;
      }

      const spans: [number, number][] = [];
      const spanCount = view.getInt32(at, false);
      at += 4;
      for (let index = 0; index < spanCount; index++) {
        const offset = Number(view.getBigUint64(at, false));
        at += 8;
        const length = view.getInt32(at, false);
        at += 4;
        spans.push([offset, length]);
      }

      const children: number[] = [];
      for (let index = 0; index < BRANCHES; index++) {
        children.push(Number(view.getBigUint64(at, false)));
        at += 8;
      }

      let branch = 0;
      while (branch < keys.length) {
        const other = keys[branch] ?? new Uint8Array();
        let order = 0;
        for (let index = 0; index < Math.min(key.length, other.length); index++) {
          const mine = key[index] ?? 0;
          const theirs = other[index] ?? 0;
          if (mine !== theirs) {
            order = mine < theirs ? -1 : 1;
            break;
          }
        }
        if (order < 0) break;
        if (order === 0) {
          const span = spans[branch];
          return span === undefined ? [] : leafIds(version, span[0], span[1]);
        }
        branch++;
      }

      const child = children[branch] ?? 0;
      if (child === 0) return [];
      address = child;
    }
    return [];
  }

  async function termIds(term: string, lang: string): Promise<number[]> {
    const separator = term.indexOf(":");
    if (separator < 0) return indexIds(term);
    const namespace = term.slice(0, separator);
    const name = term.slice(separator + 1);
    // `female:` and `male:` are not directories of their own — the namespace stays in the
    // term — and `language:` names no directory at all, it re-scopes the site-wide index.
    if (namespace === "female" || namespace === "male") return nozomiIds("tag", term, lang);
    if (namespace === "language") return nozomiIds("all", "index", name);
    return nozomiIds(namespace, name, lang);
  }

  const positive: string[] = [];
  const negative: string[] = [];
  for (const word of query.toLowerCase().trim().split(/\s+/)) {
    const term = word.replace(/_/g, " ");
    // The site's ordering terms only name feeds this source does not read, and `or` is its
    // grouping word rather than a term; both would otherwise match nothing and empty the page.
    if (term === "" || term === "or" || /^(?:sort|order)by(?:key|direction)?:/.test(term)) continue;
    if (term.startsWith("-")) negative.push(term.slice(1));
    else positive.push(term);
  }
  positive.sort((left, right) => Number(right.includes(":")) - Number(left.includes(":")));

  const namespaced = positive.some((term) => term.includes(":"));
  const [matched, excluded] = await Promise.all([
    Promise.all(positive.map((term) => termIds(term, language))),
    Promise.all(negative.map((term) => termIds(term, language))),
  ]);

  // A bare term is answered by the language-agnostic gallery index, so a language only
  // reaches those results through the site-wide feed for it.
  if (language !== "all" && !namespaced) {
    matched.push(await nozomiIds("all", "index", language));
  }
  if (matched.length === 0) matched.push(await nozomiIds("all", "index", language));

  let results = matched[0] ?? [];
  for (const ids of matched.slice(1)) {
    const set = new Set(ids);
    results = results.filter((id) => set.has(id));
  }
  for (const ids of excluded) {
    const set = new Set(ids);
    results = results.filter((id) => !set.has(id));
  }

  return results.slice(0, limit);
}
