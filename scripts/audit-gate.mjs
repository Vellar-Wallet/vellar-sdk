#!/usr/bin/env node
// Security audit gate with a NAMED allowlist for the one known advisory chain.
//
// Why this exists rather than a bare `npm audit --audit-level=…`:
// the gate was softened from `high` to `critical` on 2026-09-07, which also
// started admitting any NEW high anywhere in the tree. A soft gate that admits
// unknown highs is worse than a hard gate that admits one known chain: the
// first is invisible, the second is enumerated.
//
// So the policy is: every high must be either FIXED or on the list below, by
// advisory URL. Anything else fails. A new high is a build failure, not a line
// in a log nobody reads.
//
// ── REVIEW CHECKPOINT: 2026-12-15 ────────────────────────────────────────────
// The advisory chain below is unresolved upstream as of 2026-09-30 and a
// major-version override is unsafe inside the passkey signing path. Before or
// on 2026-12-15, re-check each advisory and either drop the entry (upstream
// fixed, so the override is no longer needed) or extend this date with a fresh
// reason. Do not let a temporary override become permanent by inattention.
// Tracked: https://github.com/Vellar-Wallet/vellar-sdk/issues/378
//
// Upstream status re-checked 2026-09-30: still vulnerable. All five highs
// resolve to one chain —
//   passkey-kit → @openzeppelin/relayer-plugin-channels → @stellar/stellar-sdk
//   (≤15.x) → toml / smol-toml
// — and nothing else in the tree reports a high.

import { execFileSync } from "node:child_process";

// Every advisory URL allowed to fail this gate, with why it is allowed.
// A NEW advisory is never added here without a recorded reason.
const ALLOWED = new Map([
  [
    "https://github.com/advisories/GHSA-7w5x-hrqm-74c2",
    "smol-toml DoS via malformed TOML. Transitive of @stellar/stellar-sdk ≤15.x. Not reachable: the SDK parses no TOML at runtime.",
  ],
  [
    "https://github.com/advisories/GHSA-82x6-q7mm-w9cf",
    "toml-node uncontrolled recursion. Transitive of @stellar/stellar-sdk ≤15.x. Not reachable: the SDK parses no TOML at runtime.",
  ],
  [
    "https://github.com/advisories/GHSA-v5mp-jgw5-2x6j",
    "toml-node prototype pollution via __proto__. Transitive of @stellar/stellar-sdk ≤15.x. Not reachable: the SDK parses no TOML at runtime.",
  ],
]);

// The expiry above, as a comparable date. After this the gate refuses to run
// at all, so a stale override cannot silently keep passing.
const REVIEW_BY = "2026-12-15";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
if (today > REVIEW_BY) {
  fail(
    `The audit allowlist review checkpoint (${REVIEW_BY}) has passed (today is ${today}). ` +
      `Re-check the three allowlisted advisories, then either remove the entry (upstream fixed) ` +
      `or extend the date in scripts/audit-gate.mjs with a fresh reason.`,
  );
}

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (err) {
  // `npm audit` exits NON-ZERO whenever it finds anything, so a throw here is
  // the normal "there are findings" path, not a crash. The JSON is on stdout.
  raw = err?.stdout;
  if (!raw) fail(`npm audit --json produced no output: ${err?.message ?? "unknown error"}`);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  fail("npm audit --json output was not valid JSON");
}

const unlisted = [];

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  // Only `high` is gated. critical would still be caught below by virtue of
  // being >= high, which is the intent: this gate's floor is `high`.
  if (vuln.severity !== "high" && vuln.severity !== "critical") continue;

  // Collect the advisory URLs behind this package. A transitive-only entry
  // (no direct `via` advisory of its own) inherits its parents' advisories,
  // which `npm audit` already reports against the root of the chain.
  const urls = (vuln.via ?? [])
    .filter((via) => typeof via === "object" && via.url)
    .map((via) => via.url);

  if (urls.length === 0) continue; // transitive wrapper; the real advisory is listed on its parent

  for (const url of urls) {
    if (!ALLOWED.has(url)) {
      unlisted.push({ name, url, severity: vuln.severity });
    }
  }
}

if (unlisted.length > 0) {
  console.error("::error::Unallowlisted high/critical advisories — these are NOT the known toml chain:");
  for (const u of unlisted) console.error(`::error::  ${u.severity} ${u.name} — ${u.url}`);
  console.error(
    "\nFix them, or if one is genuinely unavoidable, add its advisory URL to ALLOWED in " +
      "scripts/audit-gate.mjs WITH A REASON. Do not soften --audit-level to make this pass: " +
      "that re-admits every future high silently, which is the problem this gate exists to fix.",
  );
  process.exit(1);
}

console.log(
  `audit gate OK — no high/critical advisories outside the known chain ` +
    `(${ALLOWED.size} allowlisted, review by ${REVIEW_BY})`,
);
