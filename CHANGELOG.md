# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Tailspace (current: v1.0.0)

### 2026-09-05

- Initial implementation, reading tailspace.com through its React Router loader
  endpoints (`<route>.data`) rather than the rendered markup.
- Home page carries Featured, Recently Updated and Popular sections; the latter two are
  backed by the same browse query as their view-more pages.
- Search supports a title/artist query, the four site categories, include/exclude tag
  filters loaded from `/api/tags`, and the site's four public sort orders.
- Each comic is exposed as a single chapter, matching the site's flat page model.

