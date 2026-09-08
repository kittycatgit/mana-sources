import type { WebViewPageInstance } from "@mana-app/types";

import { BASE_URL, LTN_URL } from "./model.ts";

/**
 * The site's ranked listings, read inside an auxiliary WebView.
 *
 * Everything the order-by dropdown offers beyond "date added" is published only as a
 * `.nozomi` file — an array of big-endian int32 gallery ids, with no Atom counterpart the
 * way `index-` and `type/` have. `NetworkResponse.data` is a string, so those bytes reach a
 * source UTF-8 replaced and beyond recovery, while a WKWebView reads them as bytes and the
 * CDN answers any origin.
 */

type PageResponse = {
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** The page's own globals, which the source's own lib does not declare. */
type NozomiGlobals = {
  fetch(url: string, init?: { headers: Record<string, string> }): Promise<PageResponse>;
};

/**
 * The leading gallery ids of each listing, in the order the paths were given, or `undefined`
 * when the WebView route is unavailable — which is the caller's signal to show nothing
 * rather than to report an empty listing.
 */
export async function nozomiIds(
  paths: readonly string[],
  count: number,
): Promise<number[][] | undefined> {
  let page: WebViewPageInstance | undefined;
  try {
    page = await WebViewPage.create();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    return await page.evaluate<number[][], [string[], string, number]>(
      readListings,
      [...paths],
      LTN_URL,
      count,
    );
  } catch {
    return undefined;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/**
 * Runs in the page, so it reaches nothing outside itself and everything it returns is JSON.
 * One `Range` request per listing, all in flight together: a listing's head is a hundred
 * bytes and opening the page is the whole cost, so the paths are read in one visit.
 */
async function readListings(paths: string[], ltn: string, count: number): Promise<number[][]> {
  const web = globalThis as unknown as NozomiGlobals;

  return Promise.all(
    paths.map(async (path) => {
      const response = await web.fetch(`${ltn}/n/${path}.nozomi`, {
        headers: { Range: `bytes=0-${count * 4 - 1}` },
      });
      if (!response.ok) return [];

      const raw = new Uint8Array(await response.arrayBuffer());
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const ids: number[] = [];
      for (let index = 0; index < Math.floor(raw.byteLength / 4); index++) {
        ids.push(view.getInt32(index * 4, false));
      }
      return ids;
    }),
  );
}
