#!/usr/bin/env node
// Check that every external URL the documentation tells a reader to call still
// resolves (#507).
//
// The failure this exists for: three hosted services went from live to suspended
// with no signal. The docs kept instructing readers to `curl` them, nothing
// noticed, and 17 URL occurrences across docs and code silently became wrong.
//
// There is no such check on `dev` today. This module is the whole mechanism, and
// its shape is the issue's: scheduled rather than per-PR, 402 treated as success
// for paid routes, gating only on hosts the repo operates, naming the file in
// each failure. Mirroring `verify-merged.yml`'s posture — report precisely and
// fail only on what the repo controls.
//
// Four things a naive docs-only scan gets wrong, and the reason this is not just
// a regex over `website/content/docs`:
//
//   1. THE SHIPPED-DEFAULT TABLE IS THE POINT. The most important URLs are not in
//      any doc: they are constants the CLI and the MCP payer dial without the
//      reader typing anything. This tree ships eleven. A default nobody checks is
//      a default that can rot unnoticed, and it breaks the tool rather than
//      misleading a reader.
//   2. DEFAULT DRIFT MUST FAIL. Gating is keyed on HOST, so a default quietly
//      repointed at an undeclared host stops being gated at all — a silent
//      demotion from "fails the build" to "third-party, ignored", reached by
//      editing one string, with no decision made by anyone.
//   3. TEST FIXTURES ARE NOT DOCUMENTATION. Every `https://res.test/paid` in the
//      suite is a literal that was never meant to be dialled, and each competes
//      for a six-way concurrency pool shared with real endpoints.
//   4. THE SCAN MUST NOT STOP AT THE DOCS DIRECTORY. A URL documented only in the
//      repo-root README, in a design note under `docs/`, or in a contrib module is
//      still a URL this repo tells a reader to call, and the original incident
//      was a doc-rot incident.
//
// Everything that makes a network call is injected, so the whole policy is
// testable without a socket — which is the difference between a check that is
// exercised and one that is only run when something is already broken.
//
// Run standalone:  node contrib/issue-507-510-515/doc-url-gate.mjs

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from THIS FILE's location, never from process.cwd(). The original
// resolved relative paths against cwd, which made it a silent no-op: run from
// the repo root, `../../website/...` pointed outside the repo, `walk()` swallowed
// the ENOENT, and the job reported success having checked nothing.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Hosts this repo operates, and the path a reader is told to call.
 *
 * A 404 on one of these is a real regression. A 404 on a third-party docs site is
 * not this repository's problem, and blocking a merge on someone else's uptime is
 * the coupling the scheduled job exists to avoid.
 */
export const OWNED_HOSTS = [
  { host: "vellar-facilitator-production.up.railway.app", probePath: "/supported" },
  { host: "vellar-backend-production.up.railway.app", probePath: "/health" },
  { host: "vellar-explorer-production.up.railway.app", probePath: "/health", allow404: true },
  { host: "vellar-seller-demo-production.up.railway.app", probePath: "/quote" },
];

/**
 * Every service URL shipped as a default in code, not just the two the current
 * table pins.
 *
 * A stale constant here is a live bug rather than a stale doc: the CLI and the
 * MCP payer both dial these without the reader typing anything, so a dead one
 * breaks the tool rather than misleading a reader. The three Stellar endpoints
 * (Soroban RPC testnet, Soroban RPC mainnet, Horizon testnet, Horizon mainnet)
 * are third-party-operated infrastructure, so a failure there is a warning — but
 * they are still probed, because a typo in a constant is indistinguishable from
 * an outage until something distinguishes them.
 */
export const SHIPPED_DEFAULTS = [
  { file: "packages/mcp-x402-payer/src/pay-and-call.ts", url: "https://vellar-facilitator-production.up.railway.app" },
  { file: "packages/cli/src/commands/search.ts", url: "https://vellar-facilitator-production.up.railway.app" },
  { file: "packages/cli/src/commands/pay.ts", url: "https://soroban-testnet.stellar.org" },
  { file: "packages/cli/src/commands/pay.ts", url: "https://mainnet.sorobanrpc.com" },
  { file: "packages/mcp-x402-payer/src/signer.ts", url: "https://soroban-testnet.stellar.org" },
  { file: "packages/mcp-x402-payer/src/signer.ts", url: "https://mainnet.sorobanrpc.com" },
  { file: "packages/cli/src/commands/inspect.ts", url: "https://horizon-testnet.stellar.org" },
  { file: "packages/cli/src/commands/inspect.ts", url: "https://horizon.stellar.org" },
  { file: "src/config.ts", url: "https://soroban-testnet.stellar.org" },
  { file: "src/config.ts", url: "https://horizon-testnet.stellar.org" },
  { file: "src/config.ts", url: "https://horizon.stellar.org" },
];

/**
 * Hosts behind a shipped default that this repo does NOT operate, declared
 * explicitly so their non-gating status is a decision rather than a default.
 *
 * Stellar runs the public Soroban RPC and Horizon endpoints, and this repo ships
 * them as network defaults. A failure there is Stellar's uptime, not a doc bug,
 * so it stays a warning — the same posture the third-party prose links get. The
 * point of listing them is the inverse: a shipped default on a host that appears
 * in NEITHER list has been repointed somewhere nobody decided on, and that fails.
 */
export const THIRD_PARTY_DEFAULT_HOSTS = [
  "soroban-testnet.stellar.org",
  "mainnet.sorobanrpc.com",
  "horizon-testnet.stellar.org",
  "horizon.stellar.org",
];

/** Every host a shipped default is allowed to name. */
export function knownDefaultHosts() {
  return new Set([...OWNED_HOSTS.map((h) => h.host), ...THIRD_PARTY_DEFAULT_HOSTS]);
}

/** Directories and files scanned for documented URLs. Repo-relative. */
export const SCAN_TARGETS = [
  "website/content/docs",
  "website/content",
  "packages",
  "src",
  "scripts",
  // The scan used to stop here. A URL documented only in the repo-root README, in
  // a design note under docs/, or in a contrib module is still a URL this repo
  // tells a reader to call, and the original incident was a doc-rot incident.
  "contrib",
  "docs",
  "README.md",
  "CONTRIBUTING.md",
];

/**
 * Files excluded from the scan.
 *
 * Test fixtures are full of `https://res.test/paid`-style literals that were
 * never meant to be dialled. Probing them wastes the concurrency pool that real
 * endpoints share, and — worse — trains the job to report failures on hosts
 * nobody controls, which is the one thing the owned/third-party split exists to
 * avoid.
 */
export const EXCLUDED_PATH = /(^|\/)(__fixtures__|__mocks__|test|tests)(\/|$)|\.(test|spec|integration|load)\.[cm]?[jt]sx?$|\.d\.ts$/;

const SCANNED_FILE = /\.(md|ts|mjs|js|json)$/;
const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;

/** Extract candidate URLs from a file's text, trimming trailing punctuation. */
export function extractUrls(text) {
  return (text.match(URL_RE) ?? []).map((url) => url.replace(/[.,;:)]+$/, ""));
}

/** Is this path one the scan should read? */
export function isScannablePath(relativePath) {
  return SCANNED_FILE.test(relativePath) && !EXCLUDED_PATH.test(relativePath);
}

/**
 * Group URLs by the files that reference them.
 *
 * @param {Array<{file: string, text: string}>} files
 * @returns {Map<string, string[]>} url -> referencing files, deduped
 */
export function collectReferences(files) {
  const found = new Map();
  for (const { file, text } of files) {
    for (const url of extractUrls(text)) {
      const sources = found.get(url) ?? [];
      if (!sources.includes(file)) sources.push(file);
      found.set(url, sources);
    }
  }
  return found;
}

/**
 * Verify each shipped default still says what the table claims.
 *
 * Drift is a FAILURE, not a warning. Two distinct failures, and the second is
 * the one that matters:
 *
 *   - the file no longer contains the expected URL: the constant moved, renamed,
 *     or was deleted, and the table is now describing a past state;
 *   - the expected URL's host is in neither {@link OWNED_HOSTS} nor
 *     {@link THIRD_PARTY_DEFAULT_HOSTS}: the gating decision is keyed on host, so
 *     a default quietly repointed at an undeclared host stops being gated at
 *     all. That is a silent demotion from "fails the build" to "someone else's
 *     uptime", arrived at by editing one string, with no decision made by anyone.
 *
 * @param {Array<{file: string, url: string}>} defaults
 * @param {(file: string) => Promise<string | undefined>} read
 * @param {Set<string>} knownHosts {@link knownDefaultHosts}
 */
export async function auditShippedDefaults(defaults, read, knownHosts) {
  const drift = [];
  const confirmed = [];

  for (const { file, url } of defaults) {
    const text = await read(file);
    if (text === undefined) {
      drift.push({ file, url, reason: "file not found" });
      continue;
    }
    if (!text.includes(url)) {
      drift.push({ file, url, reason: "the expected default is no longer present in the file" });
      continue;
    }
    const host = hostOf(url);
    if (host !== undefined && !knownHosts.has(host)) {
      // Not necessarily wrong — an undeclared host may be perfectly fine. But
      // it is not GATED, and that is a decision someone has to make on purpose.
      drift.push({ file, url, reason: `host ${host} is declared nowhere, so the default is not gated` });
      continue;
    }
    confirmed.push({ file, url });
  }

  return { drift, confirmed };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The URL actually to be requested.
 *
 * A repo-owned host is probed at the path the docs tell a reader to call, not at
 * the bare origin: the facilitator answers `/supported` and 404s at `/`, so
 * probing the root would report a healthy service as dead.
 */
export function probeTargetFor(url, ownedHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const owned = ownedHosts.get(parsed.host);
  if (!owned) return { url, gating: false, allow404: false };
  return {
    url: new URL(owned.probePath, url).toString(),
    gating: true,
    allow404: owned.allow404 === true,
  };
}

/**
 * Is this response a pass?
 *
 * 402 is SUCCESS: it is the correct answer for a paid route, and a buyer-facing
 * check that treated it as a failure would go red the moment a route started
 * working correctly.
 */
export function isPassingStatus(status, allow404) {
  return (status >= 200 && status < 300) || status === 402 || (allow404 && status === 404);
}

/**
 * Build the check plan: what to probe, and whether a failure gates.
 *
 * @param {Map<string, string[]>} references url -> files
 * @param {Array<{file: string, url: string}>} confirmedDefaults
 * @param {Map<string, object>} owned host -> entry, as {@link OWNED_HOSTS}
 */
export function planChecks(references, confirmedDefaults, owned) {
  const targets = new Map();

  for (const [url, files] of references) {
    const target = probeTargetFor(url, owned);
    if (!target) continue; // a regex false positive that is not a URL at all
    const existing = targets.get(target.url);
    if (existing) {
      existing.files.push(...files.filter((f) => !existing.files.includes(f)));
      // Gating is a property of the host, so it ORs: if any reference to this
      // target resolves to an owned host, a failure here is this repo's fault.
      existing.gating = existing.gating || target.gating;
      existing.allow404 = existing.allow404 || target.allow404;
    } else {
      targets.set(target.url, {
        url: target.url,
        gating: target.gating,
        allow404: target.allow404,
        files: [...files],
      });
    }
  }

  // A shipped default is checked even when no doc mentions it: the constant is
  // the thing a user actually dials.
  for (const { file, url } of confirmedDefaults) {
    const target = probeTargetFor(url, owned);
    if (!target) continue;
    const existing = targets.get(target.url);
    if (existing) {
      if (!existing.files.includes(`${file} (shipped default)`)) {
        existing.files.push(`${file} (shipped default)`);
      }
    } else {
      targets.set(target.url, {
        url: target.url,
        gating: target.gating,
        allow404: target.allow404,
        files: [`${file} (shipped default)`],
      });
    }
  }

  return [...targets.values()];
}

/**
 * Turn probe results into the report, gating only on what the repo controls.
 *
 * @param {Array<{url: string, gating: boolean, allow404: boolean, files: string[]}>} checks
 * @param {Map<string, {ok: boolean, status: number, error?: string}>} results
 */
export function buildReport(checks, results) {
  const failures = [];
  const notices = [];

  for (const check of checks) {
    const result = results.get(check.url);
    if (!result) continue;
    if (result.ok) continue;
    const record = {
      url: check.url,
      status: result.status,
      error: result.error,
      files: check.files,
    };
    if (check.gating) failures.push(record);
    else notices.push(record);
  }

  return { ok: failures.length === 0, failures, notices };
}

/** Render a report as the lines a maintainer reads in CI. */
export function formatReport(report) {
  const lines = [];
  for (const n of report.notices) {
    lines.push(
      `::warning::${n.url} → ${n.status || n.error} (third-party; not gating)\n  referenced in: ${n.files.join(", ")}`,
    );
  }
  if (report.failures.length > 0) {
    lines.push(`\n${report.failures.length} repo-operated URL(s) are unreachable:`);
    for (const f of report.failures) {
      lines.push(`\n  ${f.url}`);
      lines.push(`    status: ${f.status || f.error}`);
      lines.push(`    referenced in: ${f.files.join(", ")}`);
    }
    lines.push(
      "\nThese are services this repo deploys or ships as a default, so a dead\n" +
        "one means the docs are actively wrong. Update the URL, or remove the\n" +
        "reference if the service is gone.",
    );
  } else {
    lines.push(
      `all repo-operated documented URLs resolve (${report.notices.length} third-party URL(s) reported as warnings)`,
    );
  }
  return lines;
}

// ── driver ────────────────────────────────────────────────────────────────────

async function* walk(target) {
  const full = path.join(ROOT, target);
  let entries;
  try {
    entries = await readdir(full, { withFileTypes: true });
  } catch {
    // Not a directory. A single file target (README.md) is legal; a missing one
    // is not an error, because the scan list is advisory.
    if (SCANNED_FILE.test(target) && (await readFile(full, "utf8").catch(() => undefined)) !== undefined) {
      yield full;
    }
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = path.join(full, entry.name);
    if (entry.isDirectory()) yield* walk(path.relative(ROOT, child));
    else if (SCANNED_FILE.test(entry.name)) yield child;
  }
}

async function main() {
  const read = async (file) => {
    try {
      return await readFile(path.join(ROOT, file), "utf8");
    } catch {
      return undefined;
    }
  };

  // 1. Every URL the documentation mentions, with the file it came from.
  const files = [];
  for (const target of SCAN_TARGETS) {
    for await (const absolute of walk(target)) {
      const relative = path.relative(ROOT, absolute);
      if (!isScannablePath(relative)) continue;
      files.push({ file: relative, text: await readFile(absolute, "utf8") });
    }
  }
  const references = collectReferences(files);

  // 2. Shipped code defaults, which must resolve even if every doc is edited
  //    away — and whose drift is a failure.
  const { drift, confirmed } = await auditShippedDefaults(SHIPPED_DEFAULTS, read, knownDefaultHosts());

  // 3. Probe.
  const ownedTable = new Map(OWNED_HOSTS.map((h) => [h.host, h]));
  const checks = planChecks(references, confirmed, ownedTable);
  console.log(`checking ${checks.length} documented URL(s)…\n`);

  const results = new Map();
  let next = 0;
  const CONCURRENCY = 6;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, checks.length) }, async () => {
      while (next < checks.length) {
        const check = checks[next++];
        results.set(check.url, await probe(check.url, check.allow404));
      }
    }),
  );

  // 4. Report precisely, naming every failing URL and the files that name it.
  const report = buildReport(checks, results);
  for (const line of formatReport(report)) console.log(line);

  if (drift.length > 0) {
    console.error(`\n${drift.length} shipped default(s) drifted:`);
    for (const d of drift) console.error(`  ${d.file}: ${d.reason} (${d.url})`);
    console.error(
      "\nA shipped default is what a user dials, so it is checked even when no\n" +
        "doc mentions it. Update SHIPPED_DEFAULTS in this file, or restore the\n" +
        "constant, or add the host to OWNED_HOSTS if it is now repo-operated.",
    );
  }

  process.exit(report.ok && drift.length === 0 ? 0 : 1);
}

async function probe(url, allow404) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    return { ok: isPassingStatus(res.status, allow404), status: res.status };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`url check failed: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
