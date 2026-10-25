import { type HttpClient } from "@mana-app/types";

import { acceptStatus } from "./client.ts";

/** The big-endian int32 gallery ids a `.nozomi` file or an index leaf is made of. */
export function int32s(bytes: Uint8Array, from = 0, count = -1): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const available = Math.floor((bytes.byteLength - from) / 4);
  const wanted = count < 0 ? available : Math.min(count, available);
  const ids: number[] = [];
  for (let index = 0; index < wanted; index++) ids.push(view.getInt32(from + index * 4, false));
  return ids;
}

export type ByteRange = {
  bytes: Uint8Array;
  /** The file's full length, from `content-range`, or `undefined` when it did not say. */
  total: number | undefined;
};

/**
 * A slice of a file on the CDN. Every listing the site publishes is an array of int32 ids
 * ordered the way the listing is read, so a page of one is a hundred bytes rather than the
 * megabytes the whole file runs to. The body is read as bytes, which the response hands
 * over intact; it used to cross the bridge as text and had to be asked for as base64.
 */
export async function readRange(
  http: HttpClient,
  url: string,
  first?: number,
  last?: number,
): Promise<ByteRange> {
  const ranged = first !== undefined && last !== undefined;
  const response = await http.get(url, {
    // A range that starts past the end of the file is 416, which is "no more listing"
    // rather than a failure — it is how the last page of a listing announces itself.
    ...acceptStatus(416),
    ...(ranged ? { headers: { range: `bytes=${first}-${last}` } } : {}),
  });

  if (response.status === 416) return { bytes: new Uint8Array(0), total: undefined };

  const bytes = await response.bytes();
  const range = response.headers.get("content-range") ?? "";
  const total = /\/(\d+)\s*$/.exec(range)?.[1];
  if (total !== undefined) return { bytes, total: Number.parseInt(total, 10) };

  const length = response.headers.get("content-length") ?? "";
  if (!ranged && length !== "") return { bytes, total: Number.parseInt(length, 10) };
  return { bytes, total: ranged ? undefined : bytes.byteLength };
}
