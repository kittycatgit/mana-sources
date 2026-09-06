# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Nhentai (current: v1.0.0)

### 2026-09-06

- Initial implementation, reading nhentai.net's `/api/v2` JSON API throughout. The HTML site
  sits behind a Cloudflare interstitial that a plain request cannot clear, but every API
  endpoint answers unauthenticated and unchallenged, so the source parses no markup and
  carries no cheerio.
- Home page carries Popular Right Now, Recently Added, Popular in English This Week and
  Manga This Month, each backed by a different endpoint or tag; measured overlap between any
  pair is at most two titles.
- Popular Right Now has no view-more link because `/galleries/popular` returns five
  galleries and has no second page.
- Search maps the site's own query grammar onto filters for language, format, artist,
  parody, included and excluded tags, minimum pages and minimum favourites; each one was
  proved against the live API before being declared.
- Sort offers the API's five `sort` values. The `popular-*` ones cap the result set at 20
  pages while `date` does not, which `num_pages` reports honestly, so pagination needs no
  special case for it.
- Tag options are the site's 100 most used tags, fetched at runtime and cached.
- A gallery is a single work, so one chapter is synthesised per gallery, titled with its
  page count and dated from `upload_date`.
- Covers and pages are addressed to separate CDN pools, because the two are not
  interchangeable — asking the wrong one drops the connection instead of answering 404.
- Status is COMPLETED for every gallery: the API publishes no status field, and the payload
  describing a gallery already carries every page it will ever have.
- Summaries are composed from the gallery's own metadata, since the API has no description
  field at all.

## Manga18fx (current: v1.0.0)

### 2026-09-06

- Initial implementation, reading manga18fx.com's server-rendered markup — every listing
  route shares one grid template, so a single parser backs the home page, the genre
  archives and the search results.
- Home page carries Popular Manhwa, Latest Updates, Manhwa Raw and Uncensored, each backed
  by the same query as its view-more listing; the home page's own hot carousel is the same
  query as the popular archive and is not built as a second section.
- Search takes a title query and a genre, but the site's search results and its genre
  archives are separate routes that each ignore the other's parameter, so a query wins and
  the genre applies only to an empty one — the search form says so in its footer.
- No sort control is offered, because the site has none: no listing exposes an ordering
  parameter that changes what comes back.
- Genre options are harvested from the site's own navigation at runtime, unioned with the
  two genres it only ever links from a title page.
- Pagination reads the pager's "next" anchor rather than its list item, which the site
  renders on the last page too, disabled.
- Content type comes from the genre tags rather than the title page's "Type" row, which
  reads Manhwa on every title including the ones filed under manhua.

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

