import { int32s, readRange } from "./bytes.ts";
import { LTN_URL } from "./model.ts";

/**
 * The site's own gallery index, read the way `search.js` reads it: a B-tree keyed by the
 * first four bytes of a term's SHA-256, whose leaves are runs of gallery ids in a second
 * file. Both are read a node at a time with `Range`, so a word costs six requests of 464
 * bytes and one run, not the whole index.
 */

/** Every node is padded to this and carries one more child than it has keys. */
const NODE_SIZE = 464;
const BRANCHES = 17;
/** A 17-way tree over the site's terms is six deep; the bound only stops a cycle. */
const MAX_DEPTH = 24;

const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The runtime has no `TextEncoder`, and the index is keyed on the UTF-8 of the term. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return new Uint8Array(out);
}

/** The runtime has no crypto either, and the index key is the digest's first four bytes. */
function sha256(bytes: Uint8Array): Uint8Array {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index++) w[index] = view.getUint32(block + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const x = w[index - 15]!;
      const y = w[index - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let acc = h[7]!;

    for (let index = 0; index < 64; index++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const t1 = (acc + s1 + choice + K[index]! + w[index]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      acc = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    const round = [a, b, c, d, e, f, g, acc];
    for (let index = 0; index < 8; index++) h[index] = (h[index]! + round[index]!) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 8; index++) out.setUint32(index * 4, h[index]!, false);
  return digest;
}

function compare(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const mine = left[index]!;
    const theirs = right[index]!;
    if (mine !== theirs) return mine < theirs ? -1 : 1;
  }
  return 0;
}

export async function indexVersion(http: NetworkClient): Promise<string> {
  const response = await http.get(`${LTN_URL}/galleriesindex/version?_=${Date.now()}`);
  const version = response.data.trim();
  if (!/^\d+$/.test(version)) {
    throw new Error(`Hitomi's gallery index reported "${version}" as its version.`);
  }
  return version;
}

async function leafIds(
  http: NetworkClient,
  version: string,
  offset: number,
  length: number,
): Promise<number[]> {
  if (length <= 0) return [];
  const { bytes } = await readRange(
    http,
    `${LTN_URL}/galleriesindex/galleries.${version}.data`,
    offset,
    offset + length - 1,
  );
  if (bytes.byteLength < 4) return [];

  const count = int32s(bytes, 0, 1)[0] ?? 0;
  // A run that does not fill its own span is an index that rolled under the descent.
  if (count <= 0 || bytes.byteLength !== count * 4 + 4) return [];
  return int32s(bytes, 4, count);
}

/**
 * The gallery ids a single word matches, newest first. Every date-ordered listing the site
 * publishes is its ids in descending order, so sorting the run is the same ordering the
 * site gets by intersecting the run with its own date index — for none of the cost.
 */
export async function wordIds(
  http: NetworkClient,
  version: string,
  word: string,
): Promise<number[]> {
  const key = sha256(utf8(word)).subarray(0, 4);
  let address = 0;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const { bytes } = await readRange(
      http,
      `${LTN_URL}/galleriesindex/galleries.${version}.index`,
      address,
      address + NODE_SIZE - 1,
    );
    if (bytes.byteLength < NODE_SIZE) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let at = 0;
    const keys: Uint8Array[] = [];
    const keyCount = view.getInt32(at, false);
    at += 4;
    for (let index = 0; index < keyCount; index++) {
      const size = view.getInt32(at, false);
      at += 4;
      keys.push(bytes.subarray(at, at + size));
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
      const order = compare(key, keys[branch]!);
      if (order < 0) break;
      if (order === 0) {
        const span = spans[branch];
        if (span === undefined) return [];
        const ids = await leafIds(http, version, span[0], span[1]);
        return ids.sort((left, right) => right - left);
      }
      branch++;
    }

    const child = children[branch] ?? 0;
    if (child === 0) return [];
    address = child;
  }

  return [];
}
