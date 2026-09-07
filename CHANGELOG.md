# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Nhentai (current: v1.1.0)

### 2026-09-07 — Language setting

- The source's settings now carry a reading language, chosen from the four the site
  actually stocks: English, Japanese, Chinese, and Translated for anything carrying a
  translation at all.
- The whole home page follows that choice — the hero becomes the language's most popular
  galleries, Recently Added its newest uploads, and Manga This Month its serialised manga.
  With nothing chosen the page is what it was, site-wide with an English week row.
- Searches follow it too, wherever the search screen's own language filter is left on
  "Any language"; picking a language there still wins for that one search.
- Stopped reading a Turnstile widget as a Cloudflare challenge, matching the fix the other
  sources already carried — this source was branched before it landed.

### 2026-09-06

- Initial implementation, reading nhentai.net through its public `/api/v2` endpoints. The
  HTML site sits behind a Cloudflare interstitial the app cannot clear; the API answers
  unauthenticated and unchallenged, so the source parses no markup at all.
- Home page carries Popular Right Now, Recently Added, Popular This Week and Manga This
  Month, each backed by the same query as its view-more listing.
- Search supports a keyword query, the site's five sort orders, language, format, artist
  and parody filters, include/exclude across the 100 most used tags, and minimum page and
  favourite counts.
- Each gallery is one work rather than a series, so it is exposed as a single chapter; the
  title view composes a summary from the metadata, since the API publishes none.
- Covers and pages come from two CDN pools that are not interchangeable — thumbnails only
  from the thumb servers, full pages only from the image servers.

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

