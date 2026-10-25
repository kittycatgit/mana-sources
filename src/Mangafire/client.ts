import {
  CloudflareError,
  HttpClient,
  HttpStatusError,
  type Cookie,
  type HttpRequest,
  type HttpResponse,
  type RequestContext,
  type RequestOptions,
} from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
export const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

// Markers only an interstitial carries. The bare hostname `challenges.cloudflare.com` is
// deliberately not here: sites embed Turnstile on their own forms, so it sits in the
// <head> of pages that answer 200 with the whole document — every request to such a site
// raised CloudflareError and the source looked dead while curl showed it working. Check
// anything added here against a good page from the site as well as a challenged one.
const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /cf-browser-verification/i,
  /__cf_chl_/i,
  /cf_chl_opt/i,
  /<title>\s*Just a moment/i,
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
];

export function isChallengePage(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, 4096);
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(head))) return true;
  return head.includes("pow_nonce") && head.includes("pow_hash");
}

export type ClientOptions = {
  baseUrl: string;
  /** How many requests per `interval` seconds the site is comfortable with. */
  requests?: number;
  interval?: number;
  accept?: string;
  headers?: Record<string, string>;
  resolutionUrl?: string;
  originFor?: (url: string) => string;
  json?: boolean;
  maxRetries?: number;
  /** In milliseconds. */
  timeout?: number;
};

/**
 * Statuses a request wants handed back as a response rather than thrown. The client throws
 * on anything outside 2xx — a 404 listing template parsed as a page is a silent empty row —
 * so a route that answers under another status says so on the request:
 *
 *   this.http.get(url, acceptStatus(404))
 *
 * 403 and 503 stay a `CloudflareError` whatever is accepted; see the response interceptor.
 */
export function acceptStatus(...statuses: readonly number[]): RequestOptions {
  return { metadata: { accept: [...statuses] } };
}

/** A `cookie` header from the pairs a site handed back; a request carries no cookie list. */
export function cookieHeader(cookies: readonly Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function acceptedStatuses(context: RequestContext): readonly number[] {
  const accept = context.metadata["accept"];
  return Array.isArray(accept)
    ? accept.filter((status): status is number => typeof status === "number")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(body: string, fallback: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fallback;
  }

  if (isRecord(parsed)) {
    const error = parsed["error"];
    if (isRecord(error) && typeof error["message"] === "string") return error["message"];
    if (typeof parsed["message"] === "string") return parsed["message"];
  }
  return fallback;
}

/** Whether the body is worth reading for a challenge: HTML, or a reply that does not say. */
function mayBeInterstitial(response: HttpResponse): boolean {
  const type = response.headers.get("content-type");
  return type === null || type.toLowerCase().includes("html");
}

function setDefaults(request: HttpRequest, defaults: Record<string, string>): HttpRequest {
  for (const [name, value] of Object.entries(defaults)) {
    if (!request.headers.has(name)) request.headers.set(name, value);
  }
  return request;
}

export function buildClient(options: ClientOptions): HttpClient {
  const {
    baseUrl,
    requests = 5,
    interval = 1,
    accept = options.json ? JSON_ACCEPT : HTML_ACCEPT,
    headers = {},
    resolutionUrl = baseUrl,
    originFor,
    json = false,
    maxRetries,
    timeout,
  } = options;

  const interceptRequest = (request: HttpRequest): HttpRequest => {
    const origin = originFor?.(request.url) ?? baseUrl;
    return setDefaults(request, {
      origin,
      referer: `${origin}/`,
      accept,
      "accept-language": ACCEPT_LANGUAGE,
      ...headers,
    });
  };

  const interceptResponse = async (
    response: HttpResponse,
    context: RequestContext,
  ): Promise<HttpResponse> => {
    if (response.status === 403 || response.status === 503) {
      throw new CloudflareError(resolutionUrl);
    }
    if (mayBeInterstitial(response) && isChallengePage(await response.text())) {
      throw new CloudflareError(resolutionUrl);
    }
    if (response.ok || acceptedStatuses(context).includes(response.status)) return response;
    if (json) {
      const message = errorMessage(await response.text(), "The server rejected the request");
      throw new Error(`${message} (HTTP ${response.status})`);
    }
    throw new HttpStatusError(response);
  };

  // `setRateLimit` takes the interval in milliseconds; `interval` here has always been seconds.
  const client = new HttpClient()
    .setRateLimit(requests, interval * 1000)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse);

  if (maxRetries !== undefined) client.setRetry(maxRetries);
  if (timeout !== undefined) client.setTimeoutMs(timeout);

  return client;
}

export type ImageClientOptions = {
  /** The page the image sits on; what a CDN checks before it serves. */
  referer: string;
  /** Sent only when given: some CDNs read an `origin` as a cross-site request and refuse it. */
  origin?: string;
  headers?: Record<string, string>;
  /** Per-request work — a cookie minted first, a URL resolved at the moment it is asked for. */
  prepare?: (request: HttpRequest) => Promise<HttpRequest> | HttpRequest;
  /** In milliseconds. */
  timeout?: number;
};

/**
 * The client the app loads covers and pages through, returned from `getCoverTransport` and
 * `getPageTransport`. It carries no rate limit and no status handling: the reader asks for
 * pages one at a time, and the app judges the reply itself.
 */
export function buildImageClient(options: ImageClientOptions): HttpClient {
  const { referer, origin, headers = {}, prepare, timeout } = options;

  const client = new HttpClient().addRequestInterceptor(async (request) =>
    setDefaults(prepare ? await prepare(request) : request, {
      referer,
      accept: IMAGE_ACCEPT,
      "accept-language": ACCEPT_LANGUAGE,
      ...(origin === undefined ? {} : { origin }),
      ...headers,
    }),
  );

  if (timeout !== undefined) client.setTimeoutMs(timeout);
  return client;
}
