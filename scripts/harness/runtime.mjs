// @ts-check
"use strict";

/**
 * Host shims for running a built `.mana` bundle outside the Mana app.
 *
 * The bundle is self-contained JavaScript that ends in
 * `globalThis.Target = __exports__.Target` and expects the host to provide
 * `NetworkClient`, `CloudflareError`, `NetworkError`, `ObjectStore` and
 * `SecureStore` as globals. These implementations mirror the contract the
 * in-app runtime provides, backed by Node's `fetch`.
 */

const STATUS_MESSAGES = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found.",
  405: "Method Not Allowed",
  410: "Gone.",
  429: "Too Many Requests.",
  500: "Internal Server Error.",
  502: "Bad Gateway",
  503: "Service Unavailable.",
  504: "Gateway Timeout",
};

export class NetworkError extends Error {
  constructor(name, message, req, res) {
    super(message);
    this.name = name;
    this.req = req;
    this.res = res;
  }
}

export class CloudflareError extends Error {
  constructor(resolutionURL) {
    super(`Cloudflare challenge encountered${resolutionURL ? ` (${resolutionURL})` : ""}`);
    this.name = "CloudflareError";
    this.resolutionURL = resolutionURL;
  }
}

function buildUrl(url, params) {
  if (!params) return url;
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return url;
  const query = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/**
 * The host serialises `NetworkRequest.body` from the content type — a JSON object for
 * `application/json`, a URL-encoded string for `application/x-www-form-urlencoded` — while
 * `fetch` would take a pre-stringified body happily. Modelling that here is what makes a
 * source that stringifies its own JSON body fail in the harness the way it fails in the
 * app, instead of passing every gate and erroring on the reader's phone.
 */
function encodeBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  const type = String(
    Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "",
  ).toLowerCase();

  if (type.includes("application/json")) return JSON.stringify(body);
  if (type.includes("application/x-www-form-urlencoded") && typeof body === "object") {
    return Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  }
  return body;
}

async function applyAll(value, transformers) {
  let current = value;
  for (const transform of transformers) current = await transform(current);
  return current;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Reads the private fields `NetworkClientBuilder` sets. The builder ships in
 * `@mana-app/types` and calls `new NetworkClient(this)`, so the field names
 * here are the actual contract, not a guess.
 */
export class NetworkClient {
  constructor(builder) {
    this.requestTransformers = builder?.requestTransformers ?? [];
    this.responseTransformers = builder?.responseTransformers ?? [];
    this.baseHeaders = builder?.headers ?? {};
    this.cookies = builder?.cookies ?? [];
    this.timeout = builder?.timeout ?? 30_000;
    this.requestsPerSecond = builder?.requestsPerSecond ?? 0;
    this.statusValidator = builder?.statusValidator;
    this.maxRetries = builder?.maxRetries ?? 0;
    this.lastRequestAt = 0;
  }

  get(url, config = {}) {
    return this.request({ ...config, url, method: "GET" });
  }

  post(url, config = {}) {
    return this.request({ ...config, url, method: "POST" });
  }

  async request(req) {
    await this.throttle();

    const prepared = await applyAll(
      {
        ...req,
        headers: { ...this.baseHeaders, ...(req.headers ?? {}) },
      },
      [...this.requestTransformers, ...asArray(req.transformRequest)],
    );

    const target = buildUrl(prepared.url, prepared.params);
    const headers = {};
    for (const [key, value] of Object.entries(prepared.headers ?? {})) {
      headers[key] = String(value);
    }
    const cookies = [...this.cookies, ...(prepared.cookies ?? [])];
    if (cookies.length > 0) {
      headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), prepared.timeout ?? this.timeout);

    let raw;
    try {
      raw = await fetch(target, {
        method: prepared.method ?? "GET",
        headers,
        body: encodeBody(prepared.body, headers),
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await raw.text();
    const response = {
      data,
      status: raw.status,
      headers: Object.fromEntries(raw.headers.entries()),
      request: prepared,
    };

    const validate = prepared.validateStatus ?? this.statusValidator;
    const ok = validate ? validate(raw.status) : raw.status >= 200 && raw.status < 300;

    const transformed = await applyAll(response, [
      ...this.responseTransformers,
      ...asArray(prepared.transformResponse),
    ]);

    if (!ok) {
      throw new NetworkError(
        "NetworkError",
        STATUS_MESSAGES[raw.status] ?? `Request failed with status ${raw.status}`,
        prepared,
        transformed,
      );
    }

    return transformed;
  }

  async throttle() {
    if (!this.requestsPerSecond) return;
    const minGap = 1000 / this.requestsPerSecond;
    const wait = this.lastRequestAt + minGap - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }
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
 */
class HarnessWebViewPageInstance {
  constructor(timeout) {
    this.timeout = timeout;
    this.html = "";
    this.url = "";
  }

  async goto(url, options = {}) {
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

    // The harness has no way to solve a challenge; report it the way the client does so
    // verify records SKIP rather than a misleading FAIL.
    if (/just a moment|cf-browser-verification|challenges\.cloudflare\.com/i.test(this.html.slice(0, 4096))) {
      throw new CloudflareError(this.url);
    }
  }

  async evaluate(fn, ...args) {
    return this.evaluateScript(`(${fn.toString()}).apply(null, args)`, args);
  }

  async evaluateScript(script, args = []) {
    if (!this.html) throw new Error("WebViewPage: evaluate called before goto");
    const { load } = await import("cheerio");
    const $ = load(this.html);
    const document = buildDocumentShim($, this.url);
    const run = new Function(
      "document",
      "window",
      "location",
      "args",
      `"use strict"; return (async () => { ${script.startsWith("return") ? script : `return ${script}`} })();`,
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

export const WebViewPage = {
  async create(options = {}) {
    return new HarnessWebViewPageInstance(options.timeout ?? 30);
  },
};

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

/** The intent bit layout the mana-dev runtime uses, in declaration order. */
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
];

export function decodeIntents(mask) {
  return INTENT_NAMES.filter((_, index) => (mask >> index) & 1);
}
