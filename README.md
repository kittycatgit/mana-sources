# mana-sources

Content sources for the [Mana](https://mana.moe) app.

## Install

In Mana: **Discover → Repositories → Add Repo**, and paste:

```
https://kittycatgit.github.io/mana-sources/main
```

Or open the [install page](https://kittycatgit.github.io/mana-sources/main/) and copy it
from there.

| Source | Version | Language | Rating |
| ------ | ------- | -------- | ------ |
| Tailspace | 1.1.0 | English | Explicit |
| Hiperdex | 1.0.0 | English | Mixed |
| Weebcentral | 1.0.1 | English | Mixed |

See [CHANGELOG.md](CHANGELOG.md) for what changed and when.

## Requesting a site

Open a [source request](../../issues/new?template=new-source.yml) with the site's URL —
one site per request. Requests are reviewed by hand before anything is built.

If it gets built you will get a link on the issue to install that source on its own,
before it joins the catalogue above, so you can tell us what is wrong with it.

Some sites cannot be supported: ones behind a login, ones that challenge every visitor,
and ones with no stable way to read them.

## Working on a source

```bash
npm install
npm run lint && npm run format && npm run typecheck && npm run build
npm run verify <Name> -- --verbose
```

`verify` loads the built `.mana` bundle and drives it against the live site — the four
gates only prove a source compiles, not that it returns anything. Read the `--verbose`
output as a reader would: it prints the home sections, search results and first chapter
the app will actually show.

Each source under `src/` is self-contained: `main.ts` holds the source class and its
parsing, `model.ts` its constants and filters, `client.ts` its network client, and
`forms/` the search and section helpers.

The scaffolding, the authoring guide and the tooling that builds these live in a separate
private repository; only finished sources land here.
