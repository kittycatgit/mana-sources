# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Nhentai (current: v1.1.0)

### 2026-09-07 — Language setting

- New Language setting: English, Japanese, Chinese, or Translated.
- Home page and search follow it; the search screen's own language filter still wins.
- Fixed a Turnstile widget being read as a Cloudflare challenge.

### 2026-09-06

- Reads nhentai.net through its `/api/v2` endpoints; no markup is parsed.
- Home: Popular Right Now, Recently Added, Popular This Week, Manga This Month.
- Search: keyword, five sort orders, language, format, artist and parody filters,
  include/exclude across the 100 most used tags, minimum page and favourite counts.
- Each gallery is one chapter, with a summary composed from its metadata.

## Ehentai (current: v1.1.0)

### 2026-09-07

- Chapters open in 7 seconds instead of 79; page URLs are resolved as each image is shown.
- New Hidden languages setting, applied to every listing and the search form's picker.
- Hiding Japanese also hides galleries with no language tag.
- Home rows page until they hold the number of tiles they advertise.
- Fixed opening a gallery failing with "No method provided".

### 2026-09-06

- Reads e-hentai.org's listings from markup and gallery metadata from `api.e-hentai.org`.
- Home: Popular Right Now, Latest Galleries, and the Yesterday, This Month and All-Time
  toplists.
- Search: keyword, ten categories, include/exclude tags, parody, translation language,
  gallery length, minimum rating, has-a-torrent, expunged-only.
- No sort control — the site offers none.
- Each gallery is one chapter.
- Pages served under HTTP 451 are accepted, so age-notice regions still work.

## Manga18fx (current: v1.1.0)

### 2026-09-07 — Hiding raw releases

- New Hide raw releases setting. Raw editions are dropped from every listing and the
  Manhwa Raw row is hidden; a raw title already in a library still opens.
- A listing decides it has reached the end from the page it fetched, not from what
  survived filtering.

### 2026-09-06

- Reads manga18fx.com's markup.
- Home: Popular Manhwa, Latest Updates, Manhwa Raw, Uncensored.
- Search: title query and genre picker. The site cannot combine them, so a genre applies
  only when the search box is empty.
- Content type comes from the genre tags; the site's own Type row reads Manhwa on
  everything.

## Imhentai (current: v1.0.0)

### 2026-09-06

- Reads imhentai.xxx through `/search/`, the one route Cloudflare does not challenge.
- Home: Popular Now, Latest Uploads, Top Rated, New Manga, New Western, New Artist CG.
- Most Downloaded left out — it shares 55% of its titles with Popular.
- Search: comma-separated tags, four sort orders, category and language facets.
- A gallery is one chapter; status is COMPLETED unless the title says `[ongoing]`.
- Page extensions come from each gallery's own manifest, which mixes webp and jpg.
- `getContent`, `getChapters` and `getChapterData` SKIP under `npm run verify` — they read
  a challenged route. All three were checked against gallery HTML captured from a browser.

## Madaradex (current: v1.1.1)

### 2026-09-09

- The home page arrives with every row already filled.


### 2026-09-08

- Added Trending and A–Z.

### 2026-09-06

- Reads madaradex.org through the `admin-ajax.php` endpoints its own pages call.
- Home: New Manga, Latest, Most Viewed, Top Rated.
- Chapter images carry the site as referer plus the `mdx_fp`/`mdx_auth` cookies the CDN
  requires.

## Hitomi (current: v1.2.0)

### 2026-09-07

- Search runs the site's own search: several words narrow each other, `-word` excludes,
  and `namespace:value` works.
- Search results page instead of returning one 25-entry feed.
- A query matching nothing returns an empty page instead of an error card.
- An exactly-named term wins over a longer one containing it — "dragon ball" no longer
  resolves to `dragon ball z`.
- New Language setting covering all 45 languages, applied to the home page and search.
- New in English only appears when no language is set.

### 2026-09-06

- Reads hitomi.la through its Atom feeds, gallery JSON and tag index; every page on the
  site renders client-side and arrives empty.
- Listings are 25 galleries deep and report `isLastPage` on the first page.
- Home: Just Added, New in English, Doujinshi, Manga, Game CG. Artist CG left out — it
  shares roughly 70% of Just Added.
- Search matches one term at a time, the way the site's own box does. Gallery titles are
  not searchable.
- Type and Language filters, all 45 languages. No sort options — every feed is
  newest-first.
- Chapter images need the site as referer.

## Weebcentral (current: v1.0.1)

### 2026-09-07

- Fixed the title view offering the newest chapter as the place to start.

### 2026-09-06

- Reads weebcentral.com through the htmx endpoints its own pages call.
- Home: Hot Updates, Latest Updates, Most Popular, Popular Webtoons.
- Search: title, author, type and status pickers, include/exclude tags, the Official
  Translation / Anime Adaptation / Adult Content toggles, six sort orders either way.
- Asks the site for non-adult results when the app's content rating requires it.

## Hiperdex (current: v1.0.1)

### 2026-09-08

- Chapter-count badges are written as text, for `@mana-app/types@0.0.26`.

### 2026-09-06

- Reads hiperdex.com through its tRPC API; the site is a client-rendered SPA with no
  content in its markup.
- Home: Trending Today, Latest Updates, Most Popular, Top Rated, Recently Added.
- Search: title query, seven sort orders, and type, status, rating and genre filters. The
  status picker adds "Releasing", which the site's own panel omits.
- Covers and chapter images carry the site as referer.

## Tailspace (current: v1.1.0)

### 2026-09-05 — Home page

- Home rows are Popular, Recently Updated and Top Rated, capped to a row's worth of tiles.
- Dropped the Featured hero — one comic repeated across the whole carousel.

### 2026-09-05

- Reads tailspace.com through its React Router loader endpoints.
- Search: title/artist query, the four site categories, include/exclude tags, four sort
  orders.
- Each comic is one chapter.
