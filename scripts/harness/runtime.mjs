// @ts-check
"use strict";

/**
 * Host shims for running a built `.mana` bundle outside the Mana app.
 *
 * Since `@mana-app/types@0.1.1` a bundle carries its own copy of the HTTP runtime —
 * `HttpClient`, `HttpResponse`, the errors, the rate limiter, the Cloudflare check — and
 * asks the host for exactly one thing: an adapter at `globalThis.__manaHTTPBridge` that
 * moves bytes. So what this file stands in for is the native side only: the fetch, where a
 * body lives between the reply and the read, cancellation, the operation that scopes one
 * source method, and the ciphers the app runs in native code. Everything above that line
 * runs inside the bundle exactly as it does on a device, which is the point: `verify`
 * exercises the client the app ships rather than a copy of it.
 *
 * The bundle still expects `ObjectStore`, `SecureStore` and `WebViewPage` as host globals,
 * and the operation scope comes from the package's own `http-host.generated.js`, which
 * `hostRuntimeSource()` reads out of `node_modules` so the two sides cannot drift.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { evaluateInBrowser, fetchThroughBrowser, openInBrowser } from "./browser.mjs";

/**
 * What a challenge page looks like, whatever status it arrives with. Kept in one place
 * because both paths below have to agree on it: a body that matches is not a reply to the
 * request, it is the site asking who is asking.
 *
 * Markers only an interstitial carries. Neither `challenges.cloudflare.com` nor
 * `/cdn-cgi/challenge-platform/` belongs here — a Turnstile widget on an ordinary form
 * loads both, and imhentai serves them in the <head> of the very pages this is meant to
 * rescue, so matching them declared every good page a challenge and threw the browser's
 * own answer away. Check any addition against a good page as well as a blocked one.
 */
const CHALLENGE =
  /<title>\s*just a moment|cf-browser-verification|__cf_chl_|cf_chl_opt|enable javascript and cookies to continue/i;

function looksChallenged(body) {
  return typeof body === "string" && CHALLENGE.test(body.slice(0, 8192));
}

/**
 * The host half of the HTTP runtime, read from the installed package.
 *
 * It installs `globalThis.ManaHTTP` with `runHttpOperation` and `loadImage` — the two calls
 * the app makes around a source method and an image — and patches `Promise.prototype.then`
 * so the operation follows every continuation. It has to run inside the same realm as the
 * bundle, because that is whose promises it patches and whose `globalThis` it stores the
 * current operation on.
 */
export function hostRuntimeSource() {
  const require = createRequire(import.meta.url);
  const packageRoot = path.dirname(require.resolve("@mana-app/types/package.json"));
  return fs.readFileSync(path.join(packageRoot, "dist", "runtime", "http-host.generated.js"), "utf-8");
}

/** `HttpMethod` in the bundle is a numeric enum; these are its names in order. */
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
/** `BridgeOperation`, in declaration order. */
const OPERATIONS = [
  "Fetch",
  "Read",
  "Release",
  "Cancel",
  "CreateBody",
  "RetainBody",
  "Invalidate",
  "BeginOperation",
  "EndOperation",
  "Decrypt",
  "DeriveKey",
];
const BODY_BYTES = 3;
const READ_BASE64 = 1;
const READ_BYTES = 2;
const ALGORITHM = { AesCtr: 0, AesCbc: 1, AesGcm: 2, Xor: 3, EvpBytesToKey: 4, Pbkdf2: 5 };
const PADDING = { Pkcs7: 0, Zero: 1, None: 2 };
const HASHES = ["sha1", "sha256", "sha512"];

/**
 * A byte range of a compressed representation is not decodable on its own: URLSession gives
 * up on it with "cannot decode raw data", while Node's zlib quietly returns whatever it
 * managed to inflate before the stream ran out — a handful of ids where a page of 25 was
 * expected, or none. Hitomi's CDN keeps a gzip copy of every listing and serves ranges of
 * that copy to a client that accepts gzip. The device's outcome is the one to report.
 */
function rejectCompressedRange(response, url) {
  const encoding = response.headers.get("content-encoding") ?? "";
  if (response.status !== 206 || encoding === "" || encoding === "identity") return;
  const error = new Error(
    `${url}: the server answered a byte range with content-encoding ${encoding}, which the device cannot decode (URLSessionTask "cannot decode raw data"). Ask for accept-encoding: identity on ranged requests.`,
  );
  error.name = "NetworkError";
  throw error;
}

/**
 * URLSession asks for `gzip, deflate, br` on every request, a ranged one included, and
 * Node's fetch leaves the header off whenever `range` is set. The difference decides what
 * a CDN with a precompressed copy of the file sends back: a slice of the compressed bytes,
 * which the device then fails to decode. The source's own header, when it sets one, wins.
 */
function withAcceptEncoding(headers) {
  const named = Object.keys(headers).some((key) => key.toLowerCase() === "accept-encoding");
  return named ? headers : { ...headers, "accept-encoding": "gzip, deflate, br" };
}

function headersObject(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === "set-cookie") continue;
    out[key] = value;
  }
  // Iteration yields each `set-cookie` on its own and `fromEntries` would keep the last;
  // joined the way older runtimes did, which is what the sources' cookie readers expect.
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) out["set-cookie"] = cookies.join(", ");
  return out;
}

/** Text of a body that could be an interstitial: HTML, or a refusal of unknown type. */
function challengeText(bytes, headers, status) {
  const type = String(headers["content-type"] ?? "").toLowerCase();
  if (type && !type.includes("html") && status !== 403 && status !== 503) return "";
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 8192)).toString("utf8");
}

function base64Of(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** A `CipherSpec` or key spec crosses as JSON with its byte fields in base64. */
function decodeSpec(spec) {
  const parsed = JSON.parse(String(spec));
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = ["key", "counter", "iv", "additionalData", "password", "salt"].includes(key)
      ? Buffer.from(String(value), "base64")
      : value;
  }
  return out;
}

function stripZeroPadding(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.subarray(0, end);
}

/** The ciphers the app runs natively, so a source that decrypts is exercised here too. */
function decrypt(spec, data) {
  const bits = spec.key ? spec.key.length * 8 : 0;
  switch (spec.algorithm) {
    case ALGORITHM.AesCtr: {
      const cipher = crypto.createDecipheriv(`aes-${bits}-ctr`, spec.key, spec.counter);
      return Buffer.concat([cipher.update(data), cipher.final()]);
    }
    case ALGORITHM.AesCbc: {
      const cipher = crypto.createDecipheriv(`aes-${bits}-cbc`, spec.key, spec.iv);
      cipher.setAutoPadding(spec.padding === PADDING.Pkcs7);
      const plain = Buffer.concat([cipher.update(data), cipher.final()]);
      return spec.padding === PADDING.Zero ? stripZeroPadding(plain) : plain;
    }
    case ALGORITHM.AesGcm: {
      if (data.length < 16) throw operationError("AES-GCM input is shorter than its tag");
      const cipher = crypto.createDecipheriv(`aes-${bits}-gcm`, spec.key, spec.iv);
      cipher.setAuthTag(data.subarray(data.length - 16));
      if (spec.additionalData) cipher.setAAD(spec.additionalData);
      try {
        return Buffer.concat([cipher.update(data.subarray(0, data.length - 16)), cipher.final()]);
      } catch (error) {
        throw operationError(String(error?.message ?? error));
      }
    }
    case ALGORITHM.Xor: {
      const out = Buffer.from(data);
      const end = spec.limit === undefined ? out.length : Math.min(out.length, spec.offset + spec.limit);
      for (let i = spec.offset, k = 0; i < end; i++) {
        out[i] ^= spec.key[k];
        k = k + 1 === spec.key.length ? 0 : k + 1;
      }
      return out;
    }
    default:
      throw new Error(`Unsupported cipher ${spec.algorithm}`);
  }
}

function operationError(message) {
  const error = new Error(message);
  error.name = "OperationError";
  return error;
}

function deriveKey(spec) {
  switch (spec.algorithm) {
    case ALGORITHM.EvpBytesToKey: {
      // OpenSSL's EVP_BytesToKey with MD5 and one iteration: D_i = MD5(D_{i-1} + password + salt).
      const wanted = spec.keySize + spec.ivSize;
      const blocks = [];
      let previous = Buffer.alloc(0);
      let length = 0;
      while (length < wanted) {
        previous = crypto.createHash("md5").update(previous).update(spec.password).update(spec.salt).digest();
        blocks.push(previous);
        length += previous.length;
      }
      return Buffer.concat(blocks).subarray(0, wanted);
    }
    case ALGORITHM.Pbkdf2:
      return crypto.pbkdf2Sync(spec.password, spec.salt, spec.iterations, spec.length, HASHES[spec.hash] ?? "sha256");
    default:
      throw new Error(`Unsupported key derivation ${spec.algorithm}`);
  }
}

/**
 * The native side of the HTTP runtime, backed by Node's `fetch`.
 *
 * Bodies are held here by id, as they are on a device, and handed to the bundle only when
 * it asks to read one — so a source that keeps a response past the end of its method, or
 * reads a body the operation has already released, fails here the way it fails in the app
 * rather than passing on a copy the harness quietly kept. `requiresOperation` is on for the
 * same reason: a request made outside a source operation is one the app refuses.
 *
 * Node cannot clear a Cloudflare challenge — the fingerprint is what is being judged, not
 * the request — so a reply that is an interstitial is re-issued inside the user's browser,
 * where the site's own cookies and a clearance it already granted apply. If that route is
 * unavailable the challenge page falls through untouched and the bundle's own check
 * reports it as before.
 */
export function createHttpHost() {
  /** @type {Map<string, { bytes: Uint8Array, operationID: string | undefined }>} */
  const bodies = new Map();
  /** @type {Map<string, AbortController>} */
  const inflight = new Map();
  let sequence = 0;

  const keep = (bytes, operationID) => {
    const bodyID = `body-${++sequence}`;
    bodies.set(bodyID, { bytes: new Uint8Array(bytes), operationID });
    return { bodyID, sessionID: "harness" };
  };
  const bytesOf = (bodyID) => {
    const body = bodies.get(bodyID);
    if (!body) throw new Error(`Response body ${bodyID} has been released`);
    return body.bytes;
  };

  const operations = {
    async Fetch(message) {
      const controller = new AbortController();
      inflight.set(message.requestID, controller);
      const timer = setTimeout(() => {
        const error = new Error("HTTP request deadline exceeded");
        error.name = "TimeoutError";
        controller.abort(error);
      }, message.timeoutMs ?? 30_000);
      try {
        const method = METHODS[message.method] ?? "GET";
        const body =
          message.bodyKind === undefined
            ? undefined
            : message.bodyKind === BODY_BYTES
              ? Buffer.from(message.bytes ?? Buffer.from(String(message.body ?? ""), "base64"))
              : String(message.body ?? "");
        const response = await fetch(message.url, {
          method,
          headers: withAcceptEncoding(message.headers ?? {}),
          body,
          redirect: "follow",
          signal: controller.signal,
        });
        rejectCompressedRange(response, message.url);
        let data = new Uint8Array(await response.arrayBuffer());
        let status = response.status;
        let headers = headersObject(response.headers);
        let url = response.url || message.url;

        if (looksChallenged(challengeText(data, headers, status))) {
          const viaBrowser = await fetchThroughBrowser(message.url, {
            method,
            body: typeof body === "string" ? body : undefined,
          });
          if (viaBrowser && !looksChallenged(viaBrowser.data)) {
            data = new Uint8Array(Buffer.from(viaBrowser.data, "utf8"));
            status = viaBrowser.status;
            headers = viaBrowser.headers;
            url = message.url;
          }
        }
        return { ...keep(data, message.operationID), status, url, headers };
      } finally {
        clearTimeout(timer);
        inflight.delete(message.requestID);
      }
    },

    Read(message) {
      const bytes = bytesOf(message.bodyID);
      if (message.reader === READ_BYTES) return { bytes: new Uint8Array(bytes) };
      if (message.reader === READ_BASE64) return { value: base64Of(bytes) };
      return { value: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8") };
    },

    Release(message) {
      bodies.delete(message.bodyID);
      return {};
    },

    Cancel(message) {
      inflight.get(message.requestID)?.abort();
      return {};
    },

    CreateBody(message) {
      const bytes = message.bytes ?? Buffer.from(String(message.value ?? ""), "base64");
      return keep(bytes, message.operationID);
    },

    RetainBody(message) {
      const body = bodies.get(message.bodyID);
      if (body) body.operationID = undefined;
      return {};
    },

    Invalidate() {
      bodies.clear();
      return {};
    },

    BeginOperation() {
      return {};
    },

    /** Everything the operation fetched goes with it, except what it handed to the app. */
    EndOperation(message) {
      const kept = new Set(message.keepBodyIDs ?? []);
      for (const [bodyID, body] of bodies) {
        if (body.operationID === message.operationID && !kept.has(bodyID)) bodies.delete(bodyID);
      }
      return {};
    },

    Decrypt(message) {
      const spec = decodeSpec(message.spec);
      if (message.bodyID !== undefined) {
        const plain = decrypt(spec, bytesOf(message.bodyID));
        const contentType = sniffImageType(plain);
        return { ...keep(plain, message.operationID), ...(contentType ? { contentType } : {}) };
      }
      const input = message.bytes ?? Buffer.from(String(message.value ?? ""), "base64");
      return { value: base64Of(decrypt(spec, Buffer.from(input))) };
    },

    DeriveKey(message) {
      return { value: base64Of(deriveKey(decodeSpec(message.spec))) };
    },
  };

  const bridge = {
    metadataOnly: false,
    requiresOperation: true,
    binary: false,
    crypto: Object.values(ALGORITHM),
    now: () => Date.now(),
    async send(message) {
      const handler = operations[OPERATIONS[message?.operation] ?? ""];
      if (!handler) throw new Error(`Unsupported bridge operation ${message?.operation}`);
      return handler(message);
    },
  };

  return {
    bridge,
    /** The bytes of a body the bundle exported to the host, for the harness to inspect. */
    bytesOf,
    release(bodyID) {
      bodies.delete(bodyID);
    },
    get held() {
      return bodies.size;
    },
  };
}

/** Decrypted pages say what they are in their first bytes; the app sniffs the same way. */
function sniffImageType(data) {
  const at = (i) => (i < data.length ? data[i] : -1);
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57) {
    return "image/webp";
  }
  return undefined;
}

/**
 * Stand-in for the host's auxiliary WKWebView.
 *
 * On a device `WebViewPage` opens a real WebView carrying the app's cookie jar, which is
 * how a source reaches a site the user has already cleared a Cloudflare challenge for.
 * Node has no WebView and no DOM, so this fetches the page over HTTP and exposes a
 * read-only `document` backed by cheerio — enough to exercise the parsing a source does
 * inside `evaluate`, which is the part worth testing off-device.
 *
 * What it deliberately does not do is pretend: anything beyond reading the loaded
 * document throws by name rather than returning undefined, so a source that depends on
 * real browser behaviour fails here loudly instead of passing and breaking in the app.
 *
 * `prelude` is the bundle's `__manaSerializedFunctionPrelude`. The toolchain lowers every
 * `async` function to a generator driven by an `__async` helper that lives in the bundle,
 * so the text of a function handed to `evaluate` names a helper the page does not have;
 * the app puts the helpers in front of the script, and so does this.
 */
class HarnessWebViewPageInstance {
  constructor(timeout, prelude) {
    this.timeout = timeout;
    this.prelude = prelude;
    this.html = "";
    this.url = "";
    // Whether this page is a real one in the browser, or the cheerio stand-in.
    this.live = false;
  }

  async goto(url, options = {}) {
    // A device runs the site's scripts; the stand-in below cannot. Load the page in the
    // browser first, so `evaluate` reads what the site computed rather than what it shipped.
    this.live = await openInBrowser(url);
    if (this.live) {
      this.url = url;
      const html = await evaluateInBrowser("return document.documentElement.outerHTML");
      if (html.ok) {
        this.html = typeof html.value === "string" ? html.value : "";
        if (!looksChallenged(this.html)) return;
        this.live = false; // Challenged even there: fall through and report it the usual way.
      } else if (/result is not a function/.test(html.error ?? "")) {
        // The page's own scripts have broken the eval path Playwright evaluates through —
        // hitomi.la does — so nothing can run on that page from here. A WKWebView on a
        // device is not affected. A script-free document on the same origin keeps what a
        // source reading through the page actually depends on (origin, cookies, referer),
        // so evaluation moves there, while `html` stays the page that was asked for.
        const bare = new URL("/robots.txt", url).href;
        this.live = await openInBrowser(bare);
        const fetched = this.live ? await fetchThroughBrowser(url) : null;
        this.html = fetched?.data ?? "";
        if (this.live && this.html && !looksChallenged(this.html)) return;
        this.live = false;
      } else {
        this.live = false;
      }
    }

    const controller = new AbortController();
    const ms = (options.timeout ?? this.timeout) * 1000;
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      this.html = await response.text();
      this.url = response.url || url;
    } finally {
      clearTimeout(timer);
    }

    // On a device this is a real WebView carrying a cleared cookie jar. Here the nearest
    // thing to one is the user's own browser, so a challenge is re-read through it before
    // giving up — and only when that is unavailable is it reported the way the client
    // does, leaving verify a SKIP rather than a misleading FAIL.
    if (looksChallenged(this.html)) {
      const viaBrowser = await fetchThroughBrowser(this.url);
      if (!viaBrowser || looksChallenged(viaBrowser.data)) {
        const error = new Error(`The requested resource is Cloudflare protected (${this.url})`);
        error.name = "CloudflareError";
        throw error;
      }
      this.html = viaBrowser.data;
    }
  }

  async evaluate(fn, ...args) {
    return this.evaluateScript(`return (${fn.toString()}).apply(null, args);`, args);
  }

  async evaluateScript(script, args = []) {
    if (!this.html) throw new Error("WebViewPage: evaluate called before goto");
    const body = `${this.prelude}\n${script.trimStart().startsWith("return") ? script : `return ${script}`}`;
    if (this.live) {
      const result = await evaluateInBrowser(body, args);
      if (result.ok) return result.value;
      // The page was real a moment ago and is not answering now. Reading the markup with
      // cheerio would quietly return the wrong answer, so say what happened instead.
      throw new Error(
        result.error
          ? `WebViewPage: the page threw — ${result.error}`
          : "WebViewPage: the browser stopped answering mid-page",
      );
    }
    const { load } = await import("cheerio");
    const $ = load(this.html);
    const document = buildDocumentShim($, this.url);
    const run = new Function(
      "document",
      "window",
      "location",
      "args",
      `"use strict"; return (async () => { ${body} })();`,
    );
    return run(document, { document, location: { href: this.url } }, { href: this.url }, args);
  }

  async close() {}
}

/** A read-only DOM over cheerio: the subset a source realistically reads. */
function buildDocumentShim($, url) {
  const wrap = (node) => {
    if (!node || node.length === 0) return null;
    const el = $(node);
    return {
      get textContent() {
        return el.text();
      },
      get innerHTML() {
        return el.html() ?? "";
      },
      get outerHTML() {
        return $.html(el);
      },
      getAttribute: (name) => el.attr(name) ?? null,
      querySelector: (selector) => wrap(el.find(selector).first()),
      querySelectorAll: (selector) => el.find(selector).toArray().map((n) => wrap(n)),
    };
  };

  const unsupported = (name) => () => {
    throw new Error(
      `WebViewPage shim: document.${name} is not available off-device. ` +
        `Keep what runs inside evaluate() to reading the loaded document.`,
    );
  };

  return {
    get documentElement() {
      return wrap($("html").first());
    },
    get body() {
      return wrap($("body").first());
    },
    get title() {
      return $("title").first().text();
    },
    get URL() {
      return url;
    },
    querySelector: (selector) => wrap($(selector).first()),
    querySelectorAll: (selector) => $(selector).toArray().map((n) => wrap(n)),
    getElementById: (id) => wrap($(`#${id}`).first()),
    addEventListener: unsupported("addEventListener"),
    createElement: unsupported("createElement"),
    write: unsupported("write"),
  };
}

/**
 * The `WebViewPage` global for one bundle. `prelude` is read when a page is created rather
 * than when the global is made, because the bundle sets it as it loads.
 *
 * @param {() => string} prelude
 */
export function webViewPageFor(prelude) {
  return {
    async create(options = {}) {
      return new HarnessWebViewPageInstance(options.timeout ?? 30, prelude() ?? "");
    },
  };
}

/** In-memory stand-in for the app's key-value stores. */
export class ManaStore {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  async get(k) {
    return this.values.has(k) ? this.values.get(k) : null;
  }

  async set(k, v) {
    this.values.set(k, v);
  }

  async remove(k) {
    this.values.delete(k);
  }

  async string(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "string") throw new Error(`${k} is not a string`);
    return value;
  }

  async boolean(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "boolean") throw new Error(`${k} is not a boolean`);
    return value;
  }

  async number(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "number") throw new Error(`${k} is not a number`);
    return value;
  }

  async stringArray(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new Error(`${k} is not a string array`);
    }
    return value;
  }
}

/**
 * The intent bit layout the mana-dev runtime uses, in declaration order.
 *
 * Bit 2 was `imageRequestHandler` (`willRequestImage`) and is no longer set by any
 * toolchain from 0.2.0: an image is fetched through the client `getCoverTransport` or
 * `getPageTransport` returns, and each of those has a bit of its own at the end.
 */
export const INTENT_NAMES = [
  "preferenceMenuBuilder",
  "requiresSetup",
  "imageRequestHandler",
  "pageLinkResolver",
  "libraryPageLinkProvider",
  "authenticatable",
  "basicAuth",
  "basicAuthUsesEmail",
  "webviewAuth",
  "oauthAuth",
  "providesSearch",
  "providesSearchForm",
  "providesSearchSortOptions",
  "chapterEventHandler",
  "contentEventHandler",
  "librarySyncHandler",
  "pageReadHandler",
  "progressSyncHandler",
  "groupedUpdateFetcher",
  "redrawingHandler",
  "chaptersInContent",
  "providesChapters",
  "canHandleURL",
  "allowsMultipleInstances",
  "requiresAuthenticationToAccessContent",
  "coverTransport",
  "pageTransport",
];

export function decodeIntents(mask) {
  return INTENT_NAMES.filter((_, index) => (mask >> index) & 1);
}

/**
 * The intents `mana-dev build` would compute for this instance — the evaluator in its
 * `runtime/emulator.js`, mirrored — so `verify` can hold the catalogue to what the bundle
 * actually defines.
 */
export function expectedIntents(target) {
  const bits = new Set();
  const has = (name) => typeof target?.[name] === "function";
  if (has("getPreferenceMenu")) bits.add(0);
  if (has("getSetupMenu") && has("validateSetupForm") && has("isRunnerSetup")) bits.add(1);
  if (has("getSectionsForPage") && has("resolvePageSection")) bits.add(3);
  if (has("getLibraryPageLinks")) bits.add(4);
  const basic = has("handleBasicAuth");
  const webview = has("getWebAuthRequestURL") && has("didReceiveSessionCookieFromWebAuthResponse");
  const oauth = has("getOAuthRequestURL") && has("handleOAuthCallback");
  if (has("getAuthenticatedUser") && has("handleUserSignOut") && (basic || webview || oauth)) {
    bits.add(5);
    if (basic) {
      bits.add(6);
      if (target.BasicAuthenticationUIIdentifier === 0) bits.add(7);
    } else if (webview) bits.add(8);
    else bits.add(9);
  }
  if (has("search")) bits.add(10);
  if (has("getSearchForm")) bits.add(11);
  if (has("getSortOptions")) bits.add(12);
  if (has("getContent")) {
    if (has("onChaptersMarked") && has("onChapterRead")) bits.add(13);
    if (has("onContentsAddedToLibrary") && has("onContentsRemovedFromLibrary")) bits.add(14);
    if (has("syncUserLibrary")) bits.add(15);
    if (has("onPageRead")) bits.add(16);
    if (has("getProgressState")) bits.add(17);
    if (has("getGroupedUpdates")) bits.add(18);
    if (has("shouldRedrawImage") && has("redrawImageWithSize")) bits.add(19);
    if (has("getChapterData")) {
      bits.add(21);
      if (!has("getChapters")) bits.add(20);
    }
  }
  if (has("handleURL")) bits.add(22);
  if (target?.config?.allowsMultipleInstances) bits.add(23);
  if (target?.config?.requiresAuthenticationToAccessContent) bits.add(24);
  if (has("getCoverTransport")) bits.add(25);
  if (has("getPageTransport")) bits.add(26);
  return bits;
}
