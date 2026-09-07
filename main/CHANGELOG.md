# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Weebcentral (current: v1.0.1)

### 2026-09-07

- Index the chapters from the first one. The site renders `full-chapter-list` newest-first
  and that order was kept verbatim, so the newest chapter arrived as index 0 — which made
  the title view offer it as the place to start a series nobody had read yet.

### 2026-09-06

- Initial implementation, reading weebcentral.com through the htmx endpoints its own
  pages call (`/search/data`, `/series/<id>/full-chapter-list`, `/chapters/<id>/images`)
  rather than the rendered documents.
- Home page carries Hot Updates (hero), Latest Updates, Most Popular and Popular
  Webtoons; each of the latter three is backed by the same search query as its view-more
  listing.
- Search supports a title query, an author field, type and status multi-pickers,
  include/exclude tags, the Official Translation / Anime Adaptation / Adult Content
  toggles, and the site's six sort orders in either direction.
- Honours the host's content-rating policy by asking the site for non-adult results when
  mature content is not allowed.
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

