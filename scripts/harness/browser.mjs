// @ts-check
"use strict";

/**
 * The verifier's way out of a Cloudflare challenge: fetch the page from inside the
 * browser the user is already signed in to.
 *
 * `verify` runs the built bundle on Node, so a protected route reports SKIP — the check
 * never runs and whatever it covers ships unproven. Nothing in a headless harness can
 * clear a managed challenge either: Cloudflare scores the browser, and a launched
 * Chromium is recognisably automated no matter who does the clicking, which is why
 * handing the challenge to a person in `clear-site` only ever produced a loop.
 *
 * What does pass is the user's own Chrome, driven through the Playwright extension — the
 * same route the build agent reconnoitres with, real profile and no automation flags. So
 * a challenged request is re-issued as a `fetch` inside a tab on that origin: the page's
 * own cookies apply, including any clearance already granted, and the reply comes back as
 * ordinary text the harness can hand to the source.
 *
 * Every failure here is silent by design — a missing extension, no Chrome running, a
 * server that will not start. The caller falls back to the old SKIP, so a machine without
 * the extension verifies exactly as it did before rather than failing to verify at all.
 *
 * Off with `MANA_BROWSER_FALLBACK=0`.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(ROOT, ".mcp.json");

/** Long enough for `npx` to resolve the package on a cold cache. */
const START_TIMEOUT = 90_000;
/** A challenge a person has to click through can sit for a while before it clears. */
const CALL_TIMEOUT = 120_000;
/** Past this the reply is not a page a source parses, and holding it helps nobody. */
const MAX_BODY = 8 * 1024 * 1024;

/** URLs this run had to reach through the browser, in order, for the report to name. */
export const assisted = [];

let session = null;
let disabled = process.env.MANA_BROWSER_FALLBACK === "0";

/**
 * The MCP server command, taken from `.mcp.json` so the pinned version and the extension
 * token are configured in exactly one place — a second copy here would drift the moment
 * either changed.
 */
function serverCommand() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
    const server = config.mcpServers?.playwright;
    if (!server?.args?.includes("--extension")) return null;
    return { command: server.command ?? "npx", args: server.args, env: server.env ?? {} };
  } catch {
    return null;
  }
}

/** Speaks JSON-RPC over the server's stdio: newline-delimited, one message per line. */
function connect(spec) {
  const child = spawn(spec.command, spec.args, {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...spec.env },
  });
  // The verifier must be able to exit while this is open; without unref a finished run
  // would hang on the server it started.
  child.unref();
  child.stderr?.resume();

  const pending = new Map();
  let buffer = "";
  let nextId = 1;

  child.stdout?.on("data", (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // A stray log line on stdout is not ours to interpret.
      }
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });

  const fail = (why) => {
    for (const [id, settle] of pending) {
      pending.delete(id);
      settle({ error: { message: why } });
    }
  };
  child.on("exit", () => fail("the browser server exited"));
  child.on("error", (error) => fail(String(error?.message ?? error)));

  const request = (method, params, timeout) =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: { message: `${method} timed out` } });
      }, timeout);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      try {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ error: { message: String(error?.message ?? error) } });
      }
    });

  const notify = (method) => {
    try {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    } catch {
      /* the exit handler already settled everything */
    }
  };

  return { child, request, notify };
}

/** Starts the server once and keeps it for the rest of the run; null once it has failed. */
async function open() {
  if (disabled) return null;
  if (session) return session;

  const spec = serverCommand();
  if (!spec) {
    disabled = true;
    return null;
  }

  const link = connect(spec);
  const ready = await link.request(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mana-verify", version: "1" },
    },
    START_TIMEOUT,
  );
  if (ready.error || !ready.result) {
    link.child.kill();
    disabled = true;
    return null;
  }
  link.notify("notifications/initialized");

  session = { ...link, origins: new Set() };
  // An orphaned server would outlive a run that threw on its way to closeBrowser().
  process.once("exit", closeBrowser);
  return session;
}

/** The text of a tool reply, or null if the call failed. */
function textOf(message) {
  if (message?.error || !message?.result) return null;
  if (message.result.isError) return null;
  const blocks = message.result.content ?? [];
  return blocks
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * The value `browser_evaluate` returned.
 *
 * The reply is a report for a reader — the result, then the Playwright code that ran, then
 * whatever the page did — so the value is the block under `### Result`, JSON-encoded
 * because the evaluated function returned a string.
 */
function resultOf(text) {
  if (!text) return null;
  const start = text.indexOf("### Result");
  if (start < 0) return null;
  const body = text.slice(text.indexOf("\n", start) + 1);
  const end = body.indexOf("\n### ");
  const encoded = (end < 0 ? body : body.slice(0, end)).trim();
  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

/**
 * A tab on the origin, so the fetch below is same-origin and carries the site's cookies.
 *
 * This is also the moment a challenge surfaces if the profile has not cleared one: it
 * appears in a real tab the person can solve, which is the whole point of routing through
 * their browser rather than a launched one.
 */
async function reachOrigin(link, origin) {
  if (link.origins.has(origin)) return true;
  const reply = await link.request(
    "tools/call",
    { name: "browser_navigate", arguments: { url: origin } },
    CALL_TIMEOUT,
  );
  if (textOf(reply) === null) return false;
  link.origins.add(origin);
  return true;
}

/**
 * Fetches one URL through the user's browser.
 *
 * @param {string} url
 * @param {{ method?: string, body?: any }} [options]
 * @returns {Promise<{ status: number, data: string, headers: Record<string, string> } | null>}
 *   null whenever the browser route is unavailable — the caller keeps its own behaviour.
 */
export async function fetchThroughBrowser(url, options = {}) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }

  const link = await open();
  if (!link) return null;
  if (!(await reachOrigin(link, origin))) return null;

  // Runs in the page, so the browser supplies the headers a challenge scores — its own
  // user-agent, its own TLS fingerprint — and `credentials` carries the cookies. Custom
  // request headers are deliberately dropped: the page cannot set most of them, and one
  // that contradicts the browser is what gets the request challenged again.
  const evaluate = `async () => {
    const reply = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(options.method ?? "GET")},
      credentials: "include",
      redirect: "follow",
      ${options.body === undefined ? "" : `body: ${JSON.stringify(String(options.body))},`}
    });
    const text = await reply.text();
    const headers = {};
    reply.headers.forEach((value, key) => { headers[key] = value; });
    return JSON.stringify({ status: reply.status, url: reply.url, headers, data: text.slice(0, ${MAX_BODY}) });
  }`;

  const reply = await link.request(
    "tools/call",
    { name: "browser_evaluate", arguments: { function: evaluate } },
    CALL_TIMEOUT,
  );
  const raw = resultOf(textOf(reply));
  if (typeof raw !== "string") return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof payload?.data !== "string") return null;

  assisted.push(url);
  return { status: payload.status ?? 200, data: payload.data, headers: payload.headers ?? {} };
}

/** Shuts the server down. A verify run that left it open would never exit. */
export function closeBrowser() {
  if (!session) return;
  try {
    session.child.kill();
  } catch {
    /* already gone */
  }
  session = null;
}
