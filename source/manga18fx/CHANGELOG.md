# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Manga18fx (current: v1.1.0)

### 2026-09-07 — Hiding raw releases

- New source setting, "Hide raw releases". The site publishes the untranslated Korean
  edition of a title as a separate series, and those editions are mixed through every
  listing it has — 13 of the 24 rows on the second page of Latest Updates, 11 of 24 on
  the popular archive — so a reader who only wants translated titles could not avoid
  them. With the setting on they are filtered out of every listing and the Manhwa Raw
  home row is dropped with them; a raw title already in a library still opens.
- A raw edition carries no marker of its own in a listing row, so it is recognised by its
  slug's `-raw` suffix or a heading ending in the word. Across the site's whole
  1,086-title raw archive the two together miss four titles that carry no marker at all,
  and across 525 titles from the ordinary listings neither matches anything that is not a
  raw edition.
- A listing now decides it has reached the end from what the page held rather than from
  what survived filtering, so a page filtered down to nothing no longer reports itself as
  the last one. This was already reachable through the app's content-rating filter.

### 2026-09-06

- Initial implementation, reading manga18fx.com's markup.
- Home page carries Popular Manhwa, Latest Updates, Manhwa Raw and Uncensored, each
  backed by the same route as its view-more listing.
- Search supports a title query and a genre picker. The two cannot be combined: search
  results and genre archives are separate routes and neither reads the other's parameter,
  so a genre applies only when the search box is empty.
- The genre vocabulary is harvested from the home page's own navigation — the site has no
  genre index and an unknown slug is a hard 404 — and unioned with the two genres it only
  ever links from a title page.
- Content type comes from the genre tags: the title page's own Type row reads Manhwa on
  every title, including ones filed under the manhua genre.

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

