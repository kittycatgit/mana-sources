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

### Requests from other people

Anyone can open a **Source request** issue with a site URL. Nothing runs until a
maintainer labels it. Builds happen on a maintainer's machine against their own Claude
Code login — no server, no API key, nothing listening for inbound connections.

```bash
npm run inbox            # what is waiting
npm run inbox -- --run   # build the `approved` ones
npm run inbox -- --fix   # apply the `needs-fix` ones
```

The loop:

1. Someone opens an issue with a URL.
2. A maintainer adds **`approved`**; `--run` builds it on a `source/<id>` branch.
3. That branch publishes **its own install URL**, posted back on the issue. The requester
   adds it in Mana and reports what is wrong — the extension is testable before it reaches
   the catalogue on `main`.
4. A maintainer restates the fix **in their own comment** and adds **`needs-fix`**;
   `--fix` applies it and republishes.
5. Merge the branch when it is right.

Builds have a headless browser (`@playwright/mcp`, registered in `.mcp.json`) for sites
that render client-side. It cannot clear a challenge — an automated browser is what a
challenge scores against — so a challenged site pauses instead of failing:

1. The build stops and comments on the issue saying a challenge is in the way.
2. On the build machine: `npm run clear-site -- https://thesite.com`. A real browser
   opens, you click once, you close it.
3. Re-apply `approved`. The next run reuses the same browser profile, so the clearance
   you just earned is still valid, and the build carries on headlessly.

The clearance is tied to the browser that earned it, which is why this works and a bought
token does not — and why it expires after a few hours, so re-label near when you clear.

A site that a click cannot fix is labelled `needs-human` instead, and wants the
`recon/<id>.md` handoff below.

To run the inbox on a timer instead of by hand:

```bash
cp scripts/com.kittycatgit.mana-inbox.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.kittycatgit.mana-inbox.plist
```

It checks every 15 minutes while you are logged in, one build per tick, logging to
`.inbox.log`. It must be a LaunchAgent — a LaunchDaemon runs as root and cannot reach the
keychain Claude Code authenticates from. `launchctl unload` the same path stops it.

Only comments from a maintainer are ever passed to the agent. A requester's report is a
report; it becomes an instruction when a maintainer repeats it, which is both the approval
step and what stops a stranger steering a process that holds a shell.

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
