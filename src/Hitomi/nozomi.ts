import { LTN_URL } from "./model.ts";

/**
 * The site's packed id lists, and the byte reader everything else here is built on.
 *
 * A `.nozomi` file is an array of big-endian int32 gallery ids, and the galleriesindex
 * B-tree behind search is more of the same. `NetworkResponse.data` is a string, so a
 * default request would hand those bytes back UTF-8 replaced and beyond recovery;
 * `responseEncoding: "base64"` carries them across intact.
 */

/** No `atob` and no `TextDecoder` in the runtime, so base64 is decoded by hand. */
function sixBits(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

export function base64Bytes(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4) + 3);
  let bits = 0;
  let accumulator = 0;
  let at = 0;

  for (let index = 0; index < text.length; index++) {
    const value = sixBits(text.charCodeAt(index));
    if (value < 0) continue;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (accumulator >> bits) & 0xff;
    }
  }

  return out.subarray(0, at);
}

/**
 * The bytes at a URL, or `undefined` when the CDN has no such file — a term nobody has
 * tagged has no `.nozomi`, and a 404 there is an empty result rather than a failure.
 */
export async function fetchBytes(
  http: NetworkClient,
  url: string,
  first?: number,
  last?: number,
): Promise<Uint8Array | undefined> {
  const response = await http.get(url, {
    responseEncoding: "base64",
    validateStatus: (status) => status < 500,
    ...(first === undefined ? {} : { headers: { Range: `bytes=${first}-${last}` } }),
  });

  if (response.status < 200 || response.status >= 300) return undefined;
  return base64Bytes(response.data);
}

export function readInts(raw: Uint8Array, offset: number, count: number): number[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const ids: number[] = [];
  for (let index = 0; index < count; index++) ids.push(view.getInt32(offset + index * 4, false));
  return ids;
}

export function allInts(raw: Uint8Array): number[] {
  return readInts(raw, 0, Math.floor(raw.byteLength / 4));
}

/** Every id in one `.nozomi` listing, named by its path under `/n/` without the extension. */
export async function nozomiList(http: NetworkClient, path: string): Promise<number[]> {
  const raw = await fetchBytes(http, `${LTN_URL}/n/${path}.nozomi`);
  return raw === undefined ? [] : allInts(raw);
}

/**
 * The leading gallery ids of each listing, in the order the paths were given. One `Range`
 * request per listing, all in flight together: a ranking runs to hundreds of thousands of
 * ids and only its head is ever shown.
 */
export async function nozomiIds(
  http: NetworkClient,
  paths: readonly string[],
  count: number,
): Promise<number[][]> {
  return Promise.all(
    paths.map(async (path) => {
      const raw = await fetchBytes(http, `${LTN_URL}/n/${path}.nozomi`, 0, count * 4 - 1);
      return raw === undefined ? [] : allInts(raw);
    }),
  );
}
