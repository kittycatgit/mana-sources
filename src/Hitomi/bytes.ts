const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let decodeTable: Int16Array | undefined;

/**
 * Built on first use rather than at module scope: `mana-dev build` evaluates the bundle
 * once to read its intents, and a table computed up there runs before the helper that
 * fills it, which fails the build silently and leaves the source out of the catalogue.
 */
function table(): Int16Array {
  if (decodeTable === undefined) {
    const built = new Int16Array(128).fill(-1);
    for (let index = 0; index < B64.length; index++) built[B64.charCodeAt(index)] = index;
    decodeTable = built;
  }
  return decodeTable;
}

/**
 * `NetworkResponse.data` is a string, so a binary body only survives the bridge as base64.
 * A character outside the alphabet means the body was decoded as UTF-8 instead — every
 * byte above 0x7f replaced and beyond recovery — which is what a build that does not
 * honour `responseEncoding` returns. That is reported rather than decoded into nonsense.
 */
export function base64Bytes(text: string): Uint8Array {
  const lookup = table();
  const out = new Uint8Array(Math.ceil((text.length * 3) / 4));
  let bits = 0;
  let accumulator = 0;
  let at = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 61 || code === 10 || code === 13 || code === 32 || code === 9) continue;
    const value = code < 128 ? lookup[code]! : -1;
    if (value < 0) {
      throw new Error(
        "Hitomi's packed listings came back as text rather than base64, which means this " +
          "build of Mana does not support `responseEncoding` — every listing and search on " +
          "the site is a binary file, so the source needs an app built against " +
          "@mana-app/types 0.0.27 or later.",
      );
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (accumulator >> bits) & 0xff;
    }
  }

  return out.subarray(0, at);
}

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

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return "";
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return String(headers[key] ?? "");
  }
  return "";
}

/**
 * A slice of a file on the CDN. Every listing the site publishes is an array of int32 ids
 * ordered the way the listing is read, so a page of one is a hundred bytes rather than the
 * megabytes the whole file runs to.
 */
export async function readRange(
  http: NetworkClient,
  url: string,
  first?: number,
  last?: number,
): Promise<ByteRange> {
  const ranged = first !== undefined && last !== undefined;
  const response = await http.get(url, {
    responseEncoding: "base64",
    ...(ranged ? { headers: { range: `bytes=${first}-${last}` } } : {}),
    // A range that starts past the end of the file is 416, which is "no more listing"
    // rather than a failure — it is how the last page of a listing announces itself.
    validateStatus: (status: number) => (status >= 200 && status < 300) || status === 416,
  });

  if (response.status === 416) return { bytes: new Uint8Array(0), total: undefined };

  const bytes = base64Bytes(response.data);
  const range = headerValue(response.headers, "content-range");
  const total = /\/(\d+)\s*$/.exec(range)?.[1];
  if (total !== undefined) return { bytes, total: Number.parseInt(total, 10) };

  const length = headerValue(response.headers, "content-length");
  if (!ranged && length !== "") return { bytes, total: Number.parseInt(length, 10) };
  return { bytes, total: ranged ? undefined : bytes.byteLength };
}
