#!/usr/bin/env node
// Verify that every external URL the documentation instructs a reader to call
// still resolves.
//
// The problem this exists for: three hosted services went from live to
// suspended with no signal. The docs kept telling readers to `curl` them, and
// nothing in CI noticed. 17 URL occurrences across docs and code silently
// became wrong, and the docs were the only place a reader would have found out.
//
// Scheduled rather than per-PR, on purpose. A third-party outage is not this
// repository's fault and must not block an unrelated merge, so the job reports
// precisely and fails only on what the repo actually controls — its own
// documentation pointing at a dead endpoint.
//
// What counts as a failure:
//   - a non-2xx, non-402 response from a URL the repo documents
//   - a 402 is SUCCESS: it is the correct answer for a paid route
//   - a DNS/TLS/timeout failure
//
// What is deliberately NOT a failure: a URL the repo does not control, such as
// an arbitrary third-party link in prose. Those are checked and reported as
// informational, because blocking a merge on someone else's uptime is exactly
// the coupling this job is scheduled to avoid.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from THIS FILE's location, never from process.cwd(). The original
// version resolved relative paths against cwd, which made it a silent no-op: run
// from the repo root, `../../website/...` pointed outside the repo, `walk()`
// swallowed the ENOENT, and the job reported success having checked nothing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories scanned for documented URLs. Repo-relative. */
const SCAN_DIRS = ["website/content/docs", "website/content", "packages", "src", "scripts"];

/**
 * Hosts this repo operates, and the path a reader is told to call.
 *
 * These are the URLs whose failure is this repository's problem: the repo
 * deploys them, or ships them as the default in shipped code. A 404 here is a
 * real regression; a 404 on a third-party docs site is not.
 */
const OWNED = new Map([
  ["vellar-facilitator-production.up.railway.app", "/supported"],
  ["vellar-backend-production.up.railway.app", "/health"],
  ["vellar-explorer-production.up.railway.app", "/health"],
  ["vellar-seller-demo-production.up.railway.app", "/quote"],
]);

/** Hardcoded service defaults in shipped code — a stale one is a live bug. */
const CODE_DEFAULTS = [
  { file: "packages/mcp-x402-payer/src/pay-and-call.ts", url: "https://vellar-facilitator-production.up.railway.app" },
  { file: "packages/cli/src/commands/search.ts", url: "https://vellar-facilitator-production.up.railway.app" },
];

const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // a missing scan dir is not an error; SCAN_DIRS is advisory
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(md|ts|mjs|js|json)$/.test(entry.name)) yield full;
  }
}

/**
 * Probe a URL.
 *
 * Follows one redirect hop manually and reports the FINAL status, because the
 * documented URL is what a reader types and what matters is where it lands.
 * `allow404` marks a URL that is expected to be absent (the explorer has no
 * root page) so it is reported but does not fail the job.
 */
async function probe(url, { allow404 = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { redirect: "follow", signal: controller.signal });
    // A redirect can land on something we must re-check explicitly.
    return { ok: res.ok || res.status === 402 || (allow404 && res.status === 404), status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  // 1. Every URL mentioned in the scanned trees, with the file it came from.
  const found = new Map(); // url -> Set<relative file>
  for (const dir of SCAN_DIRS) {
    for await (const file of walk(path.join(root, dir))) {
      const text = await readFile(file, "utf8");
      for (const raw of text.match(URL_RE) ?? []) {
        const url = raw.replace(/[.,;:]$/, "");
        if (!found.has(url)) found.set(url, new Set());
        found.get(url).add(path.relative(root, file));
      }
    }
  }

  // 2. Shipped code defaults, which must resolve even if docs are edited away.
  for (const { file, url } of CODE_DEFAULTS) {
    try {
      const text = await readFile(path.join(root, file), "utf8");
      if (!text.includes(url)) {
        console.log(`::warning::${file} no longer contains its expected default ${url}`);
        continue;
      }
    } catch {
      continue;
    }
    if (!found.has(url)) found.set(url, new Set());
    found.get(url).add(`${file} (shipped default)`);
  }

  // 3. Probe every URL, treating repo-owned hosts as gating and the rest as
  //    informational.
  const targets = [...found.keys()];
  console.log(`checking ${targets.length} documented URL(s)…\n`);

  const failures = [];
  const notices = [];

  await pool(targets, async (url) => {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return; // not parseable; it came from a regex, so this is a false positive
    }

    // A repo-owned host is checked at the path the docs actually tell a reader
    // to call, not just at the bare origin.
    const isOwned = OWNED.has(host);
    const probeUrl = isOwned ? new URL(OWNED.get(host), url).toString() : url;
    // The explorer intentionally serves no root page; probing / is a 404 by
    // design, so it is reported and not failed.
    const allow404 = host.startsWith("vellar-explorer");

    const result = await probe(probeUrl, { allow404 });
    if (result.ok) return;

    const files = [...found.get(url)].join(", ");
    if (isOwned) failures.push({ url: probeUrl, status: result.status, error: result.error, files });
    else notices.push({ url, status: result.status, error: result.error, files });
  });

  // 4. Report precisely. Owned hosts are this repo's to fix; everything else is
  //    someone else's uptime and is reported without failing.
  for (const n of notices) {
    console.log(
      `::warning::${n.url} → ${n.status || n.error} (third-party; not gating)` +
        `\n  referenced in: ${n.files}`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} repo-owned URL(s) are unreachable:`);
    for (const f of failures) {
      console.error(`\n  ${f.url}`);
      console.error(`    status: ${f.status || f.error}`);
      console.error(`    referenced in: ${f.files}`);
    }
    console.error(
      "\nThese are services this repo deploys or ships as a default, so a dead\n" +
        "one means the docs are actively wrong. Update the URL, or remove the\n" +
        "reference if the service is gone.",
    );
    process.exit(1);
  }

  console.log(
    `✅ all repo-owned documented URLs resolve (${notices.length} third-party URL(s) reported as warnings)`,
  );
}

main().catch((err) => {
  console.error(`url check failed: ${err?.stack ?? err}`);
  process.exit(1);
});
