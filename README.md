# mana-sources

Content sources for the Mana app.

## Install

In Mana: **Discover → Repositories → Add Repo**, and paste:

```
https://kittycatgit.github.io/mana-sources/main
```

Or open the [install page](https://kittycatgit.github.io/mana-sources/main/).

| Name | Version | Language | Rating |
| ---- | ------- | -------- | ------ |
| Tailspace | 1.0.0 | English | Explicit |

See [CHANGELOG.md](CHANGELOG.md) for what changed.

## Development

Scaffolding lives in [mana-template](https://github.com/kittycatgit/mana-template).

```bash
npm install
npm run lint && npm run format && npm run typecheck && npm run build
npm run verify <Name>
```

Pushing to `main` builds and republishes the install page.
