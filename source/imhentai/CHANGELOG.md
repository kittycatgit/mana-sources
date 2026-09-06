# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Imhentai (current: v1.0.0)

### 2026-09-06

- Initial implementation. Cloudflare challenges every route on imhentai.xxx except
  `/search/`, so search and all six home sections are built on that one route, which
  accepts the same sort and category flags as the listing pages it replaces.
- Home page carries Popular Now (hero), Latest Uploads, Top Rated, New Manga, New Western
  and New Artist CG. Most Downloaded was left out: it shares 55% of its titles with
  Popular, and two sections holding the same galleries are one section wearing two names.
- Search supports a comma-separated tag query, the site's four sort orders, and its
  category and language facets. Both facets are submitted as complete groups with an
  explicit 1 or 0 per member — a lone `m=1` is accepted and returns the unfiltered
  listing, so a partial group reads as the site ignoring the filter.
- A gallery is one finished work, so it is modelled as a single chapter holding every
  page, and its status is COMPLETED unless the uploader wrote `[ongoing]` in the title.
- Page URLs take their extension from the per-page type letter in the gallery's `g_th`
  manifest. It varies within a single gallery — 1733050 is mostly webp with jpg scattered
  through it — so assuming one extension 404s a fifth of its pages.
- Titles are decoded twice. The site stores them already-escaped and escapes them again,
  so an apostrophe arrives as `&amp;#039;` and cheerio's own decode leaves `&#039;` behind.
- `getContent`, `getChapters` and `getChapterData` **SKIP under `npm run verify`**: they
  read `/gallery/<id>/`, which is challenged to every HTTP client, and the harness runs on
  Node. In the app they fall back to `WebViewPage`, whose WebView carries the clearance the
  user establishes through `cloudflareResolutionURL`. All three were checked before release
  by driving the built bundle against gallery HTML captured from a real browser, and the
  cover and page URLs they produced were fetched to confirm they serve.

## Hiperdex (current: v1.0.0)

### 2026-09-06

- Initial implementation, reading hiperdex.com through its tRPC API at `/api/trpc` rather
  than the markup — the site is now a client-rendered SPA whose pages contain no content.
- Every API call carries the `__st` session cookie, which the server only issues in the
  `Set-Cookie` of a document request; the source fetches the landing page once for it and
  re-fetches on a 401.
- Home page carries Trending Today, Latest Updates, Most Popular, Top Rated and Recently
  Added, each backed by the same query as its view-more listing.
- Search supports a title query, the site's seven sort orders, and type, status, rating
  and genre filters; the status picker adds "Releasing", which the site's own filter panel
  omits despite 284 titles carrying it.
- Covers and chapter pages are requested with the site as their referer, without which
  both CDNs answer 403.

## Tailspace (current: v1.1.0)

### 2026-09-05 — Home page

- Home sections are Popular (hero), Recently Updated and Top Rated, each capped to what a
  home row should show rather than the site's full 60-result page.
- Dropped the Featured hero. It held the site's single featured comic, and a one-item
  `SimpleHero` repeats that cover across the whole carousel.

### 2026-09-05

- Initial implementation, reading tailspace.com through its React Router loader
  endpoints (`<route>.data`) rather than the rendered markup.
- Home page carries Featured, Recently Updated and Popular sections; the latter two are
  backed by the same browse query as their view-more pages.
- Search supports a title/artist query, the four site categories, include/exclude tag
  filters loaded from `/api/tags`, and the site's four public sort orders.
- Each comic is exposed as a single chapter, matching the site's flat page model.

