// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const distDir = path.join(cwd, "dist");
const sourcesPath = path.join(distDir, "sources.json");

if (!fs.existsSync(sourcesPath)) {
  process.stderr.write("[mana-dev] sources.json not found — skipping page generation\n");
  return;
}

/** @type {{ repositoryName?: string; sources: any[] }} */
let data;
try {
  data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
} catch {
  process.stderr.write("[mana-dev] Failed to parse sources.json — skipping page generation\n");
  return;
}

/** @type {any} */
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")); } catch {}

/**
 * Parses CHANGELOG.md's `## Extension (current: vX.Y.Z)` / `### heading` /
 * `- item` structure. Wrapped bullet lines (indented continuation, no
 * leading "-") are folded back onto the previous item so authors can wrap
 * long entries in the source file without it showing up as a second bullet.
 * @param {string} markdown
 */
function parseChangelog(markdown) {
  /** @type {{ name: string; version: string; entries: { heading: string; items: string[] }[] }[]} */
  const extensions = [];
  let currentExt = /** @type {typeof extensions[number] | null} */ (null);
  let currentEntry = /** @type {typeof extensions[number]["entries"][number] | null} */ (null);

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const extMatch = /^##\s+(.+?)\s*\(current:\s*v?([^)]+)\)\s*$/.exec(line);
    if (extMatch) {
      currentExt = { name: extMatch[1].trim(), version: extMatch[2].trim(), entries: [] };
      extensions.push(currentExt);
      currentEntry = null;
      continue;
    }

    const entryMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (entryMatch && currentExt) {
      currentEntry = { heading: entryMatch[1].trim(), items: [] };
      currentExt.entries.push(currentEntry);
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (itemMatch && currentEntry) {
      currentEntry.items.push(itemMatch[1].trim());
      continue;
    }

    if (currentEntry?.items.length && /^\s+\S/.test(rawLine)) {
      const items = currentEntry.items;
      items[items.length - 1] += ` ${line.trim()}`;
    }
  }

  return extensions;
}

/** @param {string} str */
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes text, then renders markdown `code` spans -- the only inline markdown a changelog entry needs. @param {string} text */
function renderInline(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

let changelogExtensions = /** @type {ReturnType<typeof parseChangelog>} */ ([]);
try {
  changelogExtensions = parseChangelog(fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf-8"));
} catch {
  process.stderr.write("[mana-dev] CHANGELOG.md not found -- skipping changelog section\n");
}

const repoDisplayName = data.repositoryName ?? pkg.name ?? "Extensions";
const homepage = pkg.homepage ?? "";
const sourcesUrl = homepage ? homepage.replace(/\/?$/, "/main") : "https://your-pages-url/main";

/** github.io Pages URL -> the repository it is served from, so requests can link home. */
const repoUrl = (() => {
  const m = /^https?:\/\/([^.]+)\.github\.io\/([^/]+)/.exec(homepage);
  return m ? `https://github.com/${m[1]}/${m[2]}` : "";
})();
const requestUrl = repoUrl ? `${repoUrl}/issues/new?template=new-source.yml` : "";

// A source/<id> branch publishes a preview for reviewing that one source, so the
// catalogue it serves must hold only that source — not everything already on main.
const only = process.env.MANA_ONLY ?? "";
let sources = data.sources ?? [];
if (only) {
  sources = sources.filter((s) => s.id === only || s.path === only || s.name === only);
  data.sources = sources;
  fs.writeFileSync(sourcesPath, JSON.stringify(data, null, 2), "utf-8");
  const keep = new Set(sources.map((s) => s.path));
  const bundles = path.join(distDir, "sources");
  if (fs.existsSync(bundles)) {
    for (const entry of fs.readdirSync(bundles)) {
      const base = entry.replace(/\.mana$/, "");
      if (!keep.has(base)) fs.rmSync(path.join(bundles, entry), { recursive: true, force: true });
    }
  }
  process.stdout.write(`[mana-dev] preview limited to ${only}\n`);
}

const RATING = ["Safe", "Mixed", "Explicit"];
const LANG = /** @type {Record<string,string>} */ ({
  en_US: "EN", en: "EN", ja_JP: "JA", ja: "JA", ko_KR: "KO", ko: "KO",
  zh_CN: "ZH", zh: "ZH", fr_FR: "FR", fr: "FR", de_DE: "DE", de: "DE",
  es_ES: "ES", es: "ES", pt_BR: "PT", pt: "PT", it_IT: "IT", it: "IT",
  ru_RU: "RU", ru: "RU", universal: "ALL",
});

/** @param {any} s */
function sourceRow(s) {
  const iconFile = s.thumbnail ?? "icon.png";
  const icon = s.path
    ? `<img class="icon" src="sources/${s.path}/${iconFile}" alt="" onerror="this.remove()">`
    : "";
  const rating = RATING[s.rating ?? 0] ?? "Safe";
  const langs = (s.supportedLanguages ?? []).map((l) => LANG[l] ?? l).join(" / ");
  const host = s.website ? s.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  return `<li class="source" id="src-${encodeURIComponent(s.name)}">
  <div class="icon-slot">${icon}</div>
  <div class="body">
    <h3>${escapeHtml(s.name)} <span class="ver">v${escapeHtml(String(s.version ?? "?"))}</span></h3>
    ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
    <div class="meta">
      <span class="r${s.rating ?? 0}"><i class="dot"></i>${rating}</span>
      ${langs ? `<span style="color:var(--muted)">${langs}</span>` : ""}
      ${host ? `<a href="${s.website}" target="_blank" rel="noopener">${escapeHtml(host)} &nearr;</a>` : ""}
    </div>
  </div>
</li>`;
}

/** @param {ReturnType<typeof parseChangelog>} extensions */
function changelog(extensions) {
  if (!extensions.length) return "";
  const blocks = extensions
    .map(
      (ext) => `<details>
  <summary>${escapeHtml(ext.name)} <span class="ver">${escapeHtml(ext.version)}</span></summary>
  ${ext.entries
    .map(
      (entry) => `<div class="entry">
    <h4>${escapeHtml(entry.heading)}</h4>
    <ul>${entry.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</ul>
  </div>`,
    )
    .join("")}
</details>`,
    )
    .join("\n");
  return `<section>
  <h2>Changes</h2>
  ${blocks}
</section>`;
}

// Copy source icons into dist/sources/<path>/ so the page can reach them.
for (const s of sources) {
  if (!s.path) continue;
  const iconFile = s.thumbnail ?? "icon.png";
  const srcIcon = path.join(cwd, "src", s.path, iconFile);
  if (fs.existsSync(srcIcon)) {
    const destPath = path.join(distDir, "sources", s.path, iconFile);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcIcon, destPath);
  }
}

const built = new Date().toISOString().slice(0, 10);
const count = sources.length;

/**
 * The seal: an Uzumaki spiral at the core, nine tails sweeping out of it, inside a
 * ticked ring. Drawn from maths rather than traced, so it stays crisp at any size.
 */
function seal() {
  const pt = (r, a) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;

  // Archimedean spiral, three turns, the clan mark at the centre of the seal.
  const spiral = (() => {
    const steps = 260;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 6;
      const r = 8 + t * 7.4;
      d += (i ? " L " : "M ") + pt(r, t - Math.PI / 2);
    }
    return `<path d="${d}" stroke-width="5" stroke-linecap="round"/>`;
  })();

  // Nine tails, evenly spaced, each curling the same way out of the spiral.
  const tails = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 - Math.PI / 2;
    const curl = 0.42;
    return `<path d="M ${pt(150, a)} C ${pt(212, a + curl * 0.45)}, ${pt(268, a + curl * 0.95)}, ${pt(302, a + curl * 1.7)}" stroke-width="7" stroke-linecap="round"/>`;
  }).join("");

  const ticks = Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * Math.PI * 2;
    const long = i % 10 === 0;
    return `<line x1="${pt(long ? 322 : 332, a).replace(" ", '" y1="')}" x2="${pt(344, a).replace(" ", '" y2="')}" stroke-width="${long ? 2.5 : 1}"/>`;
  }).join("");

  return `<svg class="seal" viewBox="-380 -380 760 760" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-linejoin="round">
    <g class="spin-slow">${ticks}<circle r="344" stroke-width="1.5"/><circle r="318" stroke-width="1"/></g>
    <g class="spin-fast">${tails}</g>
    <circle r="150" stroke-width="2.5"/>
    <g class="spin-core">${spiral}</g>
  </g>
</svg>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(repoDisplayName)}</title>
<meta name="description" content="Sources for Mana. Add the repository once and they all come with it.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  :root {
    --ink: #070506;
    --paper: #f4ece3;
    --muted: #8e7d72;
    --line: #241a16;
    --surface: #100b09;
    --ember: #e8590c;
    --amber: #f0a500;
    --blood: #6d1414;
    --safe: #6aa84f; --mixed: #f0a500; --explicit: #d8453a;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ink); color: var(--paper);
    font: 400 15px/1.6 Archivo, ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 24px; }

  /* ── masthead ─────────────────────────────────────────────────────────── */
  .top { position: relative; overflow: hidden; border-bottom: 1px solid var(--line); }
  .masthead { position: relative; }
  .seal {
    position: absolute; color: var(--ember); opacity: .26; pointer-events: none;
    width: min(600px, 92vw); height: min(600px, 92vw);
    left: 50%; top: 50%; transform: translate(-50%, -50%);
  }
  .spin-slow { animation: spin 300s linear infinite; transform-origin: 0 0; }
  .spin-fast { animation: spin 120s linear infinite reverse; transform-origin: 0 0; }
  .spin-core { animation: spin 200s linear infinite; transform-origin: 0 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .top::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(50% 60% at 50% 50%, rgba(232,89,12,.09), transparent 72%),
      linear-gradient(180deg, rgba(7,5,6,.55), rgba(7,5,6,.35) 45%, var(--ink));
  }
  /* must exclude the seal: this selector outranks .seal and would un-absolute it */
  .masthead > *:not(.seal) { position: relative; z-index: 2; }
  .masthead { z-index: 1; padding: 132px 0 118px; }
  .mark {
    display: inline-block; margin-bottom: 24px; padding: 6px 11px;
    border: 1px solid var(--line); border-radius: 2px;
    font: 700 10px/1 "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: .26em; text-transform: uppercase; color: var(--ember);
  }
  h1 {
    margin: 0; font-family: "Archivo Black", Archivo, sans-serif; font-weight: 400;
    font-size: clamp(40px, 8.5vw, 76px); line-height: .9; letter-spacing: -.045em;
    text-transform: uppercase; color: var(--paper);
  }
  h1 em { font-style: normal; color: var(--ember); }
  .lede { margin: 20px 0 0; max-width: 40ch; color: var(--muted); font-size: 15px; }

  /* ── install ──────────────────────────────────────────────────────────── */
  .install { position: relative; z-index: 1; margin-top: 40px; }
  .install-label {
    font: 500 11px/1 "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase; color: var(--muted);
  }
  .install-label b { color: var(--paper); font-weight: 500; }
  .url-row { display: flex; margin-top: 12px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); }
  .url {
    flex: 1; min-width: 0; padding: 15px 16px; overflow-x: auto; white-space: nowrap;
    font: 400 14px/1.2 "JetBrains Mono", ui-monospace, monospace; color: var(--amber);
  }
  button {
    flex: none; padding: 0 22px; cursor: pointer; border: 0; border-left: 1px solid var(--line);
    background: var(--ember); color: #150705;
    font: 700 12px/1 Archivo, sans-serif; letter-spacing: .1em; text-transform: uppercase;
  }
  button:hover { background: var(--amber); }

  /* ── body ─────────────────────────────────────────────────────────────── */
  main { padding: 56px 0 80px; }
  section + section { margin-top: 56px; }
  h2 {
    display: flex; align-items: center; gap: 14px; margin: 0 0 4px;
    font: 500 11px/1 "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase; color: var(--muted);
  }
  h2::after { content: ""; flex: 1; height: 1px; background: var(--line); }

  ul.sources { list-style: none; margin: 0; padding: 0; }
  .source {
    display: flex; gap: 18px; align-items: flex-start;
    padding: 24px 12px 24px 0; border-bottom: 1px solid var(--line);
    scroll-margin-top: 24px; border-radius: 4px;
    transition: background .3s, padding-left .2s;
  }
  .source:hover { background: rgba(232,89,12,.045); padding-left: 12px; }
  .source:target { background: rgba(232,89,12,.09); }
  .source:hover .icon-slot { border-color: var(--ember); }
  .icon-slot { transition: border-color .25s; }
  .icon-slot {
    flex: none; width: 56px; height: 56px; border-radius: 4px; overflow: hidden;
    background: var(--surface); border: 1px solid var(--line);
  }
  .icon { width: 100%; height: 100%; object-fit: cover; display: block; }
  .body { min-width: 0; flex: 1; }
  .source h3 {
    margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -.01em;
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  }
  .ver { font: 400 12px "JetBrains Mono", ui-monospace, monospace; color: var(--muted); }
  .source p { margin: 6px 0 0; font-size: 14px; color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 12px;
          font: 500 11px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .meta a { color: var(--muted); text-decoration: none; }
  .meta a:hover { color: var(--ember); }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 7px; vertical-align: 0; }
  .r0 { color: var(--safe); } .r1 { color: var(--mixed); } .r2 { color: var(--explicit); }
  .r0 .dot { background: var(--safe); } .r1 .dot { background: var(--mixed); } .r2 .dot { background: var(--explicit); }

  .request { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding-top: 22px; }
  .request div { max-width: 44ch; }
  .request strong { display: block; font-size: 18px; font-weight: 600; }
  .request span { color: var(--muted); font-size: 14px; }
  .request a {
    flex: none; padding: 13px 20px; border-radius: 3px; text-decoration: none;
    border: 1px solid var(--ember); color: var(--ember);
    font: 700 12px/1 Archivo, sans-serif; letter-spacing: .1em; text-transform: uppercase;
  }
  .request a:hover { background: var(--ember); color: #150705; }

  details { border-bottom: 1px solid var(--line); }
  details summary { cursor: pointer; list-style: none; padding: 16px 0; font-size: 15px; font-weight: 500; display: flex; gap: 10px; align-items: baseline; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: "→"; color: var(--ember); font-size: 13px; }
  details[open] summary::before { content: "↓"; }
  .entry { padding: 0 0 16px 22px; }
  .entry h4 { margin: 0 0 8px; font: 400 11px "JetBrains Mono", ui-monospace, monospace; color: var(--muted); letter-spacing: .1em; }
  .entry ul { margin: 0; padding-left: 18px; }
  .entry li { font-size: 14px; color: var(--muted); margin-bottom: 6px; }
  code { font: 400 12px "JetBrains Mono", ui-monospace, monospace; color: var(--amber); }

  footer { padding: 24px 0 48px; color: var(--muted);
           font: 400 11px "JetBrains Mono", ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; }
  :focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }

  @media (prefers-reduced-motion: reduce) {
    .spin-slow, .spin-fast, .spin-core { animation: none; }
  }
  @media (max-width: 560px) {
    .seal { opacity: .22; }
    .masthead { padding: 96px 0 84px; }
  }
</style>
</head>
<body>

<div class="top">
  <div class="wrap masthead">
    ${seal()}
    <span class="mark">Mana</span>
    <h1>${escapeHtml(repoDisplayName).replace(/-/g, "<em>-</em>")}</h1>
    <p class="lede">Add this once in Mana and everything below comes with it. Anything added later turns up on its own.</p>

    <div class="install">
      <div class="install-label">Discover <b>&rsaquo;</b> Repositories <b>&rsaquo;</b> Add Repo</div>
      <div class="url-row">
        <div class="url" id="url">${sourcesUrl}</div>
        <button id="copy" type="button">Copy</button>
      </div>
    </div>
  </div>
</div>

<main class="wrap">
  <section>
    <h2>${count} source${count === 1 ? "" : "s"}</h2>
    <ul class="sources">
${sources.map(sourceRow).join("\n")}
    </ul>
  </section>

  <section>
    <h2>Requests</h2>
    <div class="request">
      <div>
        <strong>Want a site added?</strong>
        <span>Open a request with its URL. One site per request.</span>
      </div>
      ${requestUrl ? `<a href="${requestUrl}" target="_blank" rel="noopener">Request a site</a>` : ""}
    </div>
  </section>

  ${changelog(changelogExtensions)}
</main>

<footer class="wrap">Updated ${built}</footer>

<script>
  document.getElementById("copy").addEventListener("click", function () {
    var b = this;
    navigator.clipboard.writeText(document.getElementById("url").textContent.trim()).then(function () {
      b.textContent = "Copied";
      setTimeout(function () { b.textContent = "Copy"; }, 1600);
    });
  });
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(distDir, "index.html"), html, "utf-8");
process.stdout.write("[mana-dev] Generated dist/index.html\n");

const changelogSrc = path.join(cwd, "CHANGELOG.md");
if (fs.existsSync(changelogSrc)) {
  fs.copyFileSync(changelogSrc, path.join(distDir, "CHANGELOG.md"));
}
