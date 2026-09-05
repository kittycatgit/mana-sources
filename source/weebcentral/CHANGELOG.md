# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Weebcentral (current: v1.0.0)

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

