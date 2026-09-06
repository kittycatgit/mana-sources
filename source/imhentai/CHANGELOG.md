# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Imhentai (current: v1.0.0)

### 2026-09-06

- Initial implementation, reading imhentai.xxx as a gallery site: one gallery is one title
  holding a single chapter of every page.
- Every home section and search goes through `/search/` rather than the matching
  `/popular/` or `/category/<slug>/` page. The site's sort and category flags express all
  of them, and `/search/` is the only route it answers without a browser-grade TLS
  fingerprint — every other path returns a Cloudflare interstitial to a plain HTTP client.
- Home page carries Popular, Latest Uploads, Top Rated, Popular Manga, Popular Doujinshi
  and Top Rated Western, each backed by the same query as its view-more listing.
- Search supports a title-or-tag query, the site's four sort orders, and its six category
  and seven language facets. Each facet group is sent whole (`m=1&d=0&…`) because the site
  accepts and silently ignores a lone flag.
- Page URLs are built from the gallery's `load_server`/`load_dir`/`load_id` inputs plus the
  `g_th` script, which is the only place each page's file extension is stated — a webp page
  404s when requested as jpg.
- Titles are decoded twice: the site stores them already-escaped and escapes them again, so
  cheerio's own decode leaves a literal `&#039;` behind.
- `getContent`, `getChapters` and `getChapterData` report SKIP under `npm run verify`. The
  gallery route refuses Node's TLS fingerprint; the three were checked against pages fetched
  with `curl`, including fetching every cover and page URL produced.

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

