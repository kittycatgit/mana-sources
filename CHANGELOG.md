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

## Ehentai (current: v1.1.0)

### 2026-09-07

- Opening a chapter spent one request per page before the reader saw anything, which took
  79 seconds on the 478-page gallery that led the home page — long enough to read as
  images that never load. The image URL only exists inside the `/s/` viewer page it
  belongs to and the site's bulk viewer refuses anyone not signed in, so those pages are
  now handed to the reader as-is and resolved one at a time in `willRequestImage`. The
  same gallery opens in seven seconds, and each image URL is minted when it is displayed
  rather than up to a minute beforehand.
- Added a Hidden languages setting to the source's preferences. A hidden language is left
  out of every listing, dropped from the search form's language picker, and — for the
  listings the site lets a query reach — excluded server-side as `-language:"x"$` so the
  page still comes back full.
- Hiding Japanese hides galleries carrying no language tag at all, which is what an
  untranslated Japanese work looks like on this site; there is no `-language:` term that
  can express that, so those rows are dropped from the listing instead.
- Home sections now page until they have the tiles they advertise. Hiding a language can
  leave a 25-row page holding one gallery, and the month's toplist was showing a single
  item where it promised twelve.

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

## Madaradex (current: v1.0.1)

### 2026-09-06

- Initial implementation, reading madaradex.org's WordPress/Madara theme through the
  `admin-ajax.php` endpoints its own pages call rather than the rendered listings.
- Home page carries New Manga, Latest, Most Viewed and Top Rated, each backed by the same
  query as its view-more listing.
- Chapter pages are served from `cdn.madaradex.org`, which answers 403 without
  madaradex.org as the referer, and — since the `madaradex-shield` plugin — without the
  `mdx_fp`/`mdx_auth` cookie pair `admin-ajax.php` issues in exchange for a fingerprint.
  `willRequestImage` carries all three; sending `origin` alongside the referer puts the
  403 back, because the CDN reads that as a cross-site XHR.

## Hitomi (current: v1.2.0)

### 2026-09-07

- Search now runs the site's own search rather than an approximation of it, so a query
  matches gallery titles and several words narrow each other. "asuna family" returned
  nothing where the site returns 68 galleries, and "midareuchi" returned the 7 galleries
  its circle published where the site returns 83, because a query was only ever resolved
  to one tag and read back as that tag's feed. `-word` to exclude and `namespace:value`
  now work too, and the search form says so.
- Search results page. A query resolves to a list of ids rather than a single 25-entry
  feed, so the reader can page through it; the list is held while they do, because the
  descent behind it costs a dozen round trips.
- The index behind that search is raw big-endian int32 and `NetworkResponse.data` is a
  string, which mangles it. The descent therefore runs inside an auxiliary WebView opened
  on hitomi.la, which reads bytes and holds the CORS grant the CDN issues that origin. If
  no WebView is available the old tag-index route still answers, minus gallery titles.
- Search now prefers a term the query names exactly over the longest one containing it. The
  tag index matches anywhere in a term and orders what it finds by gallery count, so
  "dragon ball" resolved to the larger `dragon ball z` feed and every gallery tag tapped on
  a title view was resolved the same loose way.
- A query that matches nothing returns an empty page instead of throwing. It reached the
  reader as an error card, when the honest answer is that the site has no results for it.
- New Language setting in the source's own preferences, covering all 45 languages the site
  publishes. Every listing follows it: the home page, and search whenever its own Language
  filter is left alone. That filter's first option is titled with the language in force so
  it cannot read as "All languages" while the setting narrows it.
- The New in English home section now only appears while no language is set, where before
  it would have duplicated Just Added or shown the one language the reader ruled out.

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
## Hiperdex (current: v1.0.1)

### 2026-09-08

- The chapter-count badge on a listing tile is written as text. `@mana-app/types@0.0.26`
  redefines a badge as a short label the source supplies, where it used to be a count and a
  colour the host rendered itself.

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

