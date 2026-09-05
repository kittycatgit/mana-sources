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

const sources = data.sources ?? [];

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
  const langs = (s.supportedLanguages ?? []).map((l) => LANG[l] ?? l).join(" · ");
  const host = s.website ? s.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  return `<li class="source">
  <div class="icon-slot">${icon}</div>
  <div class="body">
    <h3>${escapeHtml(s.name)} <span class="ver">${escapeHtml(String(s.version ?? "?"))}</span></h3>
    ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
    <div class="meta">
      <span class="tag r${s.rating ?? 0}">${rating}</span>
      ${langs ? `<span class="tag">${langs}</span>` : ""}
      ${host ? `<a href="${s.website}" target="_blank" rel="noopener">${escapeHtml(host)}</a>` : ""}
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

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(repoDisplayName)}</title>
<meta name="description" content="Content sources for the Mana app.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Archivo+Black&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  :root {
    /* Kurama: black fur, burnt orange, the red of the cloak, the gold of the eye. */
    --ink: #080605;
    --surface: #150e0b;
    --line: #2c1c14;
    --text: #f6eee8;
    --muted: #a3877a;
    --accent: #f97316;
    --ember: #c2410c;
    --seal: #7f1d1d;
    --eye: #fbbf24;
    --safe: #6ba368;
    --mixed: #f4a11f;
    --explicit: #e04b3c;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--ink); color: var(--text);
    font: 400 15px/1.55 Archivo, ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 0 20px; }

  /* ── hero ─────────────────────────────────────────────────────────────── */
  .hero { position: relative; overflow: hidden; padding: 88px 0 56px; }
  .hero canvas, .hero .aura, .hero .tails { position: absolute; inset: 0; pointer-events: none; }
  .aura {
    background:
      radial-gradient(55% 50% at 50% 78%, rgba(249,115,22,.22), transparent 70%),
      radial-gradient(90% 60% at 50% -14%, rgba(127,29,29,.38), transparent 72%);
  }
  .hero::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 140px;
    background: linear-gradient(180deg, transparent, var(--ink)); pointer-events: none;
  }
  .tails svg { width: 100%; height: 100%; display: block; }
  .tails path { transform-origin: 50% 100%; animation: sway 9s ease-in-out infinite; }
  .tails path:nth-child(2n) { animation-duration: 11s; animation-direction: reverse; }
  .tails path:nth-child(3n) { animation-duration: 13s; }
  @keyframes sway { 0%,100% { transform: rotate(-1.2deg); } 50% { transform: rotate(1.2deg); } }

  .hero-inner { position: relative; text-align: center; }
  .eye { width: 44px; height: 44px; margin: 0 auto 20px; display: block; }
  h1 {
    margin: 0; font-family: "Archivo Black", Archivo, sans-serif; font-weight: 400;
    font-size: clamp(38px, 9vw, 68px); line-height: .95; letter-spacing: -0.035em;
    text-transform: uppercase;
    background: linear-gradient(175deg, #fff6ea 12%, var(--accent) 58%, var(--ember) 88%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .kicker {
    margin: 18px 0 0; font: 600 12px/1 "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: .24em; text-transform: uppercase; color: #c9a894;
  }

  /* ── install ──────────────────────────────────────────────────────────── */
  .install {
    position: relative; margin-top: 40px; padding: 20px;
    border: 1px solid var(--line); border-radius: 12px;
    background: linear-gradient(180deg, #1d120c, var(--surface));
    box-shadow: 0 0 0 1px rgba(249,115,22,.06), 0 24px 60px -30px rgba(249,115,22,.55);
  }
  .install p { margin: 0 0 12px; font-size: 14px; color: var(--muted); text-align: left; }
  .install b { color: var(--text); font-weight: 500; }
  .url-row { display: flex; gap: 8px; }
  .url {
    flex: 1; min-width: 0; padding: 12px;
    background: #0b0705; border: 1px solid var(--line); border-radius: 8px;
    font: 400 13px/1.3 "JetBrains Mono", ui-monospace, monospace; color: var(--accent);
    overflow-x: auto; white-space: nowrap; text-align: left;
  }
  button {
    flex: none; padding: 0 18px; cursor: pointer; color: #170a03;
    background: linear-gradient(180deg, var(--accent), var(--ember));
    border: 0; border-radius: 8px; font: 600 13px Archivo, sans-serif;
  }
  button:hover { filter: brightness(1.1); }
  button:active { transform: translateY(1px); }

  /* ── content ──────────────────────────────────────────────────────────── */
  main { padding-bottom: 72px; }
  section { margin-top: 52px; }
  h2 {
    margin: 0 0 16px; font-size: 11px; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: var(--muted);
  }
  ul.sources { list-style: none; margin: 0; padding: 0; }
  .source { display: flex; gap: 14px; padding: 18px 0; border-top: 1px solid var(--line); }
  .source:first-child { border-top: 0; padding-top: 0; }
  .icon-slot {
    flex: none; width: 48px; height: 48px; border-radius: 10px; overflow: hidden;
    background: var(--surface); border: 1px solid var(--line);
  }
  .icon { width: 100%; height: 100%; object-fit: cover; display: block; }
  .body { min-width: 0; }
  .source h3 { margin: 0; font-size: 16px; font-weight: 600; }
  .source p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
  .ver { font: 400 11px "JetBrains Mono", ui-monospace, monospace; color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
  .meta a { font-size: 12px; color: var(--muted); text-decoration: none; border-bottom: 1px solid var(--line); }
  .meta a:hover { color: var(--accent); border-color: var(--accent); }
  .tag {
    font: 600 10px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .07em;
    text-transform: uppercase; padding: 4px 7px; border-radius: 4px;
    background: var(--surface); border: 1px solid var(--line); color: var(--muted);
  }
  .r0 { color: var(--safe); } .r1 { color: var(--mixed); } .r2 { color: var(--explicit); }

  .request { border: 1px solid var(--line); border-radius: 12px; padding: 20px; background: var(--surface); }
  .request p { margin: 0 0 4px; font-size: 15px; font-weight: 500; }
  .request small { display: block; color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  .request a {
    display: inline-block; padding: 10px 16px; border-radius: 8px; text-decoration: none;
    border: 1px solid var(--accent); color: var(--accent); font-size: 13px; font-weight: 600;
  }
  .request a:hover { background: var(--accent); color: #170a03; }

  details { border-top: 1px solid var(--line); }
  details summary { cursor: pointer; list-style: none; padding: 13px 0; font-size: 14px; font-weight: 500; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: "+ "; color: var(--accent); }
  details[open] summary::before { content: "− "; }
  .entry { padding: 0 0 12px 16px; }
  .entry h4 { margin: 0 0 6px; font: 400 11px "JetBrains Mono", ui-monospace, monospace; color: var(--muted); }
  .entry ul { margin: 0; padding-left: 16px; }
  .entry li { font-size: 13px; color: var(--muted); margin-bottom: 5px; }
  code { font: 400 12px "JetBrains Mono", ui-monospace, monospace; color: var(--accent); }

  footer { color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding: 18px 0 40px; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .tails path { animation: none; }
    html { scroll-behavior: auto; }
  }
</style>
</head>
<body>

<div class="hero">
  <div class="aura"></div>
  <div class="tails" aria-hidden="true">
    <svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="t" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#f97316" stop-opacity=".42"/>
          <stop offset="55%" stop-color="#c2410c" stop-opacity=".14"/>
          <stop offset="100%" stop-color="#7f1d1d" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#t)" stroke-width="9" stroke-linecap="round">
        <path d="M400 420 C 250 330, 150 250, 96 120"/>
        <path d="M400 420 C 270 330, 196 236, 168 84"/>
        <path d="M400 420 C 300 332, 258 232, 254 66"/>
        <path d="M400 420 C 350 330, 330 230, 336 56"/>
        <path d="M400 420 C 400 320, 400 220, 400 48"/>
        <path d="M400 420 C 450 330, 470 230, 464 56"/>
        <path d="M400 420 C 500 332, 542 232, 546 66"/>
        <path d="M400 420 C 530 330, 604 236, 632 84"/>
        <path d="M400 420 C 550 330, 650 250, 704 120"/>
      </g>
    </svg>
  </div>
  <canvas id="embers"></canvas>

  <div class="wrap hero-inner">
    <svg class="eye" viewBox="0 0 40 40" aria-hidden="true">
      <ellipse cx="20" cy="20" rx="19" ry="12" fill="#fbbf24"/>
      <ellipse cx="20" cy="20" rx="19" ry="12" fill="none" stroke="#7f1d1d" stroke-width="2"/>
      <ellipse cx="20" cy="20" rx="3.4" ry="11" fill="#080605"/>
    </svg>
    <h1>${escapeHtml(repoDisplayName)}</h1>
    <p class="kicker">${count} source${count === 1 ? "" : "s"} for Mana</p>

    <div class="install">
      <p>In Mana: <b>Discover &rsaquo; Repositories &rsaquo; Add Repo</b></p>
      <div class="url-row">
        <div class="url" id="url">${sourcesUrl}</div>
        <button id="copy" type="button">Copy</button>
      </div>
    </div>
  </div>
</div>

<main class="wrap">
  <section>
    <h2>Sources</h2>
    <ul class="sources">
${sources.map(sourceRow).join("\n")}
    </ul>
  </section>

  <section>
    <h2>Request a site</h2>
    <div class="request">
      <p>Want a site added?</p>
      <small>Open a request with its URL. One site per request.</small>
      ${requestUrl ? `<a href="${requestUrl}" target="_blank" rel="noopener">Open a request</a>` : ""}
    </div>
  </section>

  ${changelog(changelogExtensions)}

  <footer>Updated ${built}</footer>
</main>

<script>
  document.getElementById("copy").addEventListener("click", function () {
    var b = this;
    navigator.clipboard.writeText(document.getElementById("url").textContent.trim()).then(function () {
      b.textContent = "Copied";
      setTimeout(function () { b.textContent = "Copy"; }, 1600);
    });
  });

  // Embers drifting up out of the tails. Cheap: a few dozen dots, no libraries.
  (function () {
    var c = document.getElementById("embers");
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var x = c.getContext("2d"), w = 0, h = 0, dots = [];
    function size() {
      var r = c.parentElement.getBoundingClientRect();
      w = c.width = r.width * devicePixelRatio;
      h = c.height = r.height * devicePixelRatio;
      c.style.width = r.width + "px";
      c.style.height = r.height + "px";
    }
    function seed() {
      dots = [];
      for (var i = 0; i < 44; i++) {
        dots.push({
          x: Math.random() * w, y: Math.random() * h,
          r: (Math.random() * 1.6 + 0.5) * devicePixelRatio,
          v: (Math.random() * 0.35 + 0.12) * devicePixelRatio,
          d: Math.random() * 6.28, a: Math.random() * 0.5 + 0.2
        });
      }
    }
    function frame() {
      x.clearRect(0, 0, w, h);
      for (var i = 0; i < dots.length; i++) {
        var p = dots[i];
        p.y -= p.v; p.d += 0.01; p.x += Math.sin(p.d) * 0.25 * devicePixelRatio;
        if (p.y < -8) { p.y = h + 8; p.x = Math.random() * w; }
        x.globalAlpha = p.a * (p.y / h);
        x.fillStyle = "#f97316";
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.28); x.fill();
      }
      requestAnimationFrame(frame);
    }
    size(); seed(); frame();
    addEventListener("resize", function () { size(); seed(); });
  })();
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
