# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Ehentai (current: v1.0.1)

### 2026-09-06

- Opening any gallery failed with "E-Hentai rejected the metadata request: No method
  provided". The `gdata` body was stringified by the source and then serialised again by
  the host, so the API received a quoted string instead of a request object. The body is
  now handed over as an object.

### 2026-09-06

- Initial implementation, reading e-hentai.org's listings from its markup and every
  gallery's metadata from `api.e-hentai.org/api.php` (`gdata`), which carries the title,
  category, uploader, page count, rating and full tag list in one request.
- Home page carries Popular Right Now, Latest Galleries and the Yesterday, This Month and
  All-Time gallery toplists, each backed by the same query as its view-more listing.
- Listings are cursor-paged rather than offset-paged — `?page=` is accepted and ignored,
  and the only way to page 2 is the `next=<gid>` link page 1 printed. The source walks and
  remembers that trail, so ordinary forwards paging still costs one request per page.
- Search supports a keyword query, the ten categories, include/exclude tags, parody, the
  translation language, gallery length, a minimum rating, "has a torrent" and "expunged
  only". Length is a picker rather than a pair of steppers because the site refuses any
  range narrower than 20 pages.
- No sort control: listings are always newest first and the site offers no alternative.
- Each gallery is exposed as a single chapter, matching the site's one-upload model, and
  its pages are resolved from the `/s/` page each thumbnail links to.
- Responses are accepted at HTTP 451 as well as 2xx. The site serves the complete page
  under that status where local law makes it add an age notice, and rejecting it would
  leave those readers with an empty app.

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

