import { LTN_URL } from "./model.ts";
import { fetchBytes, nozomiList, readInts } from "./nozomi.ts";

/**
 * The site's own search, run against the files `search.js` reads.
 *
 * A query resolves through `galleriesindex` — a B-tree keyed by the first four bytes of each
 * term's SHA-256, whose leaves are runs of big-endian int32 gallery ids — and every
 * namespaced term through a `.nozomi` file of the same ints. Both are raw bytes, which
 * `responseEncoding: "base64"` carries across intact.
 */

/** How many ids a search keeps. A common tag matches six figures; 40 pages is plenty. */
const ID_LIMIT = 1000;
/** Every B-tree node is padded to this, and carries one more child than it has keys. */
const NODE_SIZE = 464;
const BRANCHES = 17;
/** A 16-way tree over the site's terms is six deep; the bound only stops a cycle. */
const MAX_DEPTH = 24;

/**
 * The gallery ids a query matches, newest first, or `undefined` when the index itself could
 * not be read — which is the caller's signal to fall back rather than report no results.
 *
 * It mirrors `do_search` in the site's `results.js`: namespaced terms seed the result set
 * because their feed is already ordered and language-scoped, the remaining terms narrow it,
 * and a `-term` removes what it matches.
 */
export async function searchIndexIds(
  http: NetworkClient,
  query: string,
  language: string,
): Promise<string[] | undefined> {
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

  try {
    let version: Promise<string> | undefined;
    const termsOf = (term: string): Promise<number[]> => {
      const separator = term.indexOf(":");
      if (separator < 0) {
        version ??= indexVersion(http);
        return version.then((current) => indexIds(http, current, term));
      }
      const namespace = term.slice(0, separator);
      const name = term.slice(separator + 1);
      // `female:` and `male:` are not directories of their own — the namespace stays in the
      // term — and `language:` names no directory at all, it re-scopes the site-wide index.
      if (namespace === "female" || namespace === "male") {
        return feedIds(http, "tag", term, language);
      }
      if (namespace === "language") return feedIds(http, "all", "index", name);
      return feedIds(http, namespace, name, language);
    };

    const namespaced = positive.some((term) => term.includes(":"));
    const [matched, excluded] = await Promise.all([
      Promise.all(positive.map(termsOf)),
      Promise.all(negative.map(termsOf)),
    ]);

    // A bare term is answered by the language-agnostic gallery index, so a language only
    // reaches those results through the site-wide feed for it.
    if (language !== "all" && !namespaced) {
      matched.push(await feedIds(http, "all", "index", language));
    }
    if (matched.length === 0) matched.push(await feedIds(http, "all", "index", language));

    let results = matched[0] ?? [];
    for (const ids of matched.slice(1)) {
      const set = new Set(ids);
      results = results.filter((id) => set.has(id));
    }
    for (const ids of excluded) {
      const set = new Set(ids);
      results = results.filter((id) => !set.has(id));
    }

    return results.slice(0, ID_LIMIT).map(String);
  } catch {
    return undefined;
  }
}

// -- the feeds ---------------------------------------------------------------

function feedIds(
  http: NetworkClient,
  area: string,
  tag: string,
  language: string,
): Promise<number[]> {
  // The site strips these two characters from a term rather than escaping them, and its
  // XHR percent-encodes the spaces a tag name carries but leaves the namespace colon.
  const name = tag.replace(/[/#]/g, "").replace(/ /g, "%20");
  const path = area === "all" ? `${name}-${language}` : `${area}/${name}-${language}`;
  return nozomiList(http, path);
}

async function indexVersion(http: NetworkClient): Promise<string> {
  const response = await http.get(`${LTN_URL}/galleriesindex/version?_=${Date.now()}`);
  const version = response.data.trim();
  if (!/^\d+$/.test(version)) {
    throw new Error("Hitomi's search index no longer names a version — its shape changed.");
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

  const raw = await fetchBytes(
    http,
    `${LTN_URL}/galleriesindex/galleries.${version}.data`,
    offset,
    offset + length - 1,
  );
  if (raw === undefined) return [];

  const count = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, false);
  // A run that does not fill its own span is a version that rolled under the descent.
  if (count <= 0 || raw.byteLength !== count * 4 + 4) return [];
  return readInts(raw, 4, count);
}

/** Descends the B-tree to the run of ids a bare term names, comparing keys byte by byte. */
async function indexIds(http: NetworkClient, version: string, term: string): Promise<number[]> {
  const key = sha256(utf8Bytes(term)).subarray(0, 4);

  let address = 0;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const raw = await fetchBytes(
      http,
      `${LTN_URL}/galleriesindex/galleries.${version}.index`,
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
      const order = compare(key, keys[branch] ?? new Uint8Array());
      if (order < 0) break;
      if (order === 0) {
        const span = spans[branch];
        return span === undefined ? [] : leafIds(http, version, span[0], span[1]);
      }
      branch++;
    }

    const child = children[branch] ?? 0;
    if (child === 0) return [];
    address = child;
  }
  return [];
}

function compare(key: Uint8Array, other: Uint8Array): number {
  for (let index = 0; index < Math.min(key.length, other.length); index++) {
    const mine = key[index] ?? 0;
    const theirs = other[index] ?? 0;
    if (mine !== theirs) return mine < theirs ? -1 : 1;
  }
  return 0;
}

// -- SHA-256 -----------------------------------------------------------------

/**
 * The runtime is a bare V8 context with no `crypto` and no `TextEncoder`, so the digest the
 * B-tree is keyed by is computed here. Terms carry tag names, which are not all ASCII.
 */

const INITIAL_STATE: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index++;
      }
    }

    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function rotate(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0;
}

function sha256(message: Uint8Array): Uint8Array {
  const hash = Uint32Array.from(INITIAL_STATE);
  const blocks = Math.floor((message.length + 8) / 64) + 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = message.length * 8;
  view.setUint32(blocks * 64 - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(blocks * 64 - 4, bits >>> 0, false);

  const schedule = new Uint32Array(64);
  for (let block = 0; block < blocks; block++) {
    for (let index = 0; index < 16; index++) {
      schedule[index] = view.getUint32(block * 64 + index * 4, false);
    }
    for (let index = 16; index < 64; index++) {
      const left = schedule[index - 15]!;
      const right = schedule[index - 2]!;
      const mix0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const mix1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      schedule[index] = schedule[index - 16]! + mix0 + schedule[index - 7]! + mix1;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;

    for (let index = 0; index < 64; index++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }

    const round = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index++) hash[index] = hash[index]! + round[index]!;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 8; index++) out.setUint32(index * 4, hash[index]!, false);
  return digest;
}
