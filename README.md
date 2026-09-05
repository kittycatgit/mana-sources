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
| Tailspace | 1.1.0 | English | Explicit |

See [CHANGELOG.md](CHANGELOG.md) for what changed.

## Development

Scaffolding lives in [mana-template](https://github.com/kittycatgit/mana-template).

```bash
npm install
npm run lint && npm run format && npm run typecheck && npm run build
npm run verify <Name>
```

### From a URL

```bash
npm run new-from-url -- https://example.com
```

Runs Claude Code headlessly against the `mana-extension` skill, then re-runs lint, format,
typecheck, build and `verify --verbose` itself — the agent's account of its own work is not
evidence. On success it pushes a branch and opens a PR with the verbose output in the body;
on any failure it rolls back to `main` (`--keep` to inspect instead). It never commits to
`main`.

Needs the skill in `.claude/skills/` (gitignored here — copy it from
[mana-template](https://github.com/kittycatgit/mana-template)) and `gh` authenticated.

Pushing to `main` builds and republishes the install page.
