# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Hitomi (current: v1.0.0)

### 2026-09-06

- Initial implementation, reading hitomi.la through the Atom feeds, gallery JSON and tag
  index on `ltn.gold-usergeneratedcontent.net` and `tagindex.hitomi.la` rather than the
  markup — every page on the site is rendered client-side and arrives empty.
- Listings are one Atom feed deep, 25 galleries, and report `isLastPage` on the first
  page. The site's own paginated listings are `.nozomi` files — arrays of big-endian
  int32 gallery ids — and the runtime hands every response back as a UTF-8 string, which
  mangles them beyond recovery. The feeds are the only listing endpoint that answers as
  text.
- Home page carries Just Added, New in English, Doujinshi, Manga and Game CG. Artist CG
  was dropped: it shares roughly 70% of Just Added, because artist CG sets dominate the
  site's recent uploads.
- Search matches one term at a time, the way the site's own search box does — a typed
  query is resolved against the tag index to a tag, artist, series, character or group,
  and a term that resolves to nothing throws rather than returning a silent empty list.
  Gallery titles are not searchable; that index is binary too.
- Type and Language filters, with all 45 languages the site publishes, each confirmed to
  return entries. No sort options: every feed is newest-first and the site offers no
  other order on them.
- Chapter pages are built from the rotating path prefix and subdomain table in `gg.js`,
  re-fetched every 20 minutes. Both image CDNs answer 404 without the site as referer.

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

