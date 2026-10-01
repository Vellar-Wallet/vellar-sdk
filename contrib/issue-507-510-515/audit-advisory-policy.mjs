#!/usr/bin/env node
// Named-allowlist policy for the one known advisory chain (#515).
//
// Why this exists rather than a bare `npm audit --audit-level=…`: both ci.yml:29
// and publish.yml:33 run `npm audit --audit-level=critical`, softened from
// `high` on 2026-09-07 with the comment "Restore to --audit-level=high when
// upstream resolves." That restores nothing on its own. A soft gate also admits
// any NEW high anywhere in the tree, and a gate that admits unknown highs
// silently is worse than a gate that enumerates one known chain: the first is
// invisible, the second is enumerated.
//
// So the policy is: every high must be either FIXED or on the list below, by
// advisory URL. Anything else fails. A new high is a build failure, not a line
// in a log nobody reads. And the list carries a review date, so a temporary
// override cannot become permanent by inattention.
//
// Three things the inline `--audit-level` flag cannot do, which is why this is
// a function and not a flag:
//
//   1. COUNTS ARE COMPUTED, NOT ASSERTED IN A COMMENT. Five vulnerable PACKAGES
//      carrying three high ADVISORIES is not a contradiction, it is two counts —
//      and a hand-written number in a comment drifts silently.
//   2. STALE ALLOWLIST ENTRIES SURFACE. If upstream fixes an advisory the entry
//      becomes dead weight that still reads as "we are carrying a known risk".
//      A fixed advisory should be visibly removable, not invisible.
//   3. THE ALLOWLIST IS PINNED TO THE CHAIN, NOT TO THE ADVISORY. Each entry
//      declares the node paths it may appear on. An allowlisted advisory turning
//      up anywhere else is a different exposure wearing a familiar label.
//
// Point 3 is not hypothetical — see `ALLOWED_ADVISORIES`. The issue describes all
// five highs as one chain, and four of them are. The fifth, `smol-toml`, is on
// the PRODUCTION path via the root `@stellar/stellar-sdk@16.2.0`, reached by a
// different route than the dev-only `passkey-kit` chain, and a reachability
// argument written for the dev chain does not apply to it.
//
// Run standalone:  node contrib/issue-507-510-515/audit-advisory-policy.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";

/** The review checkpoint. After this date the allowlist must be re-justified. */
export const REVIEW_BY = "2026-12-15";

/** The date the current chain was re-checked against upstream. */
export const LAST_RECHECKED = "2026-09-30";

/** Where the status is tracked. */
export const TRACKING_ISSUE = "https://github.com/Vellar-Wallet/vellar-sdk/issues/378";

/**
 * The dev-only chain, and the two advisories that reach it.
 *
 * `expectedNodes` are `package-lock.json` install paths. `npm audit` reports the
 * same paths in `vulnerabilities[].nodes`, so the two can be compared directly:
 * an allowlisted advisory on any other path is a separate exposure and fails.
 * That is what keeps the smol-toml entry honest — it is a production-path
 * advisory, so it declares the root path and does not borrow the dev chain's
 * justification.
 */
export const ALLOWED_ADVISORIES = [
  {
    url: "https://github.com/advisories/GHSA-7w5x-hrqm-74c2",
    title: "smol-toml: Denial of Service via malformed TOML documents",
    severity: "high",
    vulnerableRange: "<=1.7.0",
    expectedNodes: ["node_modules/smol-toml"],
    /** Reached from the PRODUCTION root stellar-sdk, not the dev-only chain. */
    productionPath: true,
    reachedVia: "@stellar/stellar-sdk@16.2.0 → smol-toml ^1.6.1 (root peer dependency)",
    reason:
      "smol-toml parses TOML for the SDK's contract-configuration and simulation " +
      "inputs, all of which are operator-supplied rather than attacker-supplied " +
      "on a hosted payer. The DoS requires a malformed document, which the SDK " +
      "does not fetch from a network endpoint.",
  },
  {
    url: "https://github.com/advisories/GHSA-82x6-q7mm-w9cf",
    title: "toml-node: Uncontrolled Recursion",
    severity: "high",
    vulnerableRange: "<4.2.0",
    expectedNodes: ["node_modules/toml"],
    productionPath: false,
    reachedVia:
      "passkey-kit → @openzeppelin/relayer-plugin-channels@0.20.0 → " +
      "@stellar/stellar-sdk@14.6.1 → toml ^3.0.0",
    reason:
      "dev-only chain reached through the optional `passkey-kit` peer dependency. " +
      "Uncontrolled recursion needs attacker-supplied TOML, and this chain " +
      "parses none at runtime.",
  },
  {
    url: "https://github.com/advisories/GHSA-v5mp-jgw5-2x6j",
    title:
      "toml-node: Prototype Pollution Leads to `Object.prototype` Corruption via `__proto__` Key-Path Desynchronization",
    severity: "high",
    vulnerableRange: "<4.1.2",
    expectedNodes: ["node_modules/toml"],
    productionPath: false,
    reachedVia:
      "passkey-kit → @openzeppelin/relayer-plugin-channels@0.20.0 → " +
      "@stellar/stellar-sdk@14.6.1 → toml ^3.0.0",
    reason:
      "Same dev-only chain. Prototype pollution requires attacker-supplied TOML; " +
      "this chain parses none at runtime.",
  },
];

/**
 * How each allowlisted advisory can be closed, verified against the registry on
 * 2026-09-30.
 *
 * ci.yml's comment defers the decision to "when upstream resolves". Upstream
 * has resolved it, and for the `toml` half the obvious route — a `toml` 4.x
 * override — really would be a major bump, because `@stellar/stellar-sdk@14.6.1`
 * pins `toml@^3.0.0` and every fix is 4.x or 5.x. Neither half needs that,
 * though: `smol-toml` is in-range, and bumping `passkey-kit` removes the `toml`
 * copy outright. The distinction is the useful finding of this re-check.
 */
export const RESOLUTION_PLAN = [
  {
    advisory: "GHSA-7w5x-hrqm-74c2",
    closable: true,
    action: 'Add "smol-toml": "1.9.0" to `overrides` in package.json.',
    why:
      "The vulnerable range is <=1.7.0 and the root @stellar/stellar-sdk@16.2.0 " +
      "already depends on `smol-toml@^1.6.1`, so 1.7.1+ is IN RANGE. This is the " +
      "same shape as the existing `fast-uri: 3.1.7` override that already closes " +
      "four highs: a lockfile-level pin, no major version, nothing in the passkey " +
      "signing path touched. No justification is needed to keep carrying it.",
  },
  {
    advisory: "GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j",
    closable: true,
    action:
      "Bump the `passkey-kit` devDependency 0.16.5 → 0.17.0+ and widen the " +
      "declared peer range `>=0.13.0 <0.17.0` to admit it.",
    why:
      "passkey-kit@0.17.0 DROPPED `@openzeppelin/relayer-plugin-channels` " +
      "entirely (verified across 0.17.0, 0.17.3, 0.18.0, 0.18.3, 0.19.0, 0.19.1 " +
      "— none declares the dependency). The toml@3.0.0 copy exists only under " +
      "that package, so the bump removes it outright rather than overriding it. " +
      "This needs a peer-range change, which is a maintainer decision and is " +
      "correctly not something CI forces — but it is a MINOR bump, not the " +
      "major-version override the current comment rules out.",
  },
];

/** Severities the gate fails on. `high` is the floor the repo policy sets. */
export const GATE_SEVERITIES = new Set(["high", "critical"]);

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

/**
 * Evaluate an `npm audit --json` report against the allowlist.
 *
 * Pure: takes the parsed report and returns a verdict. Nothing here shells out
 * or reads the filesystem, so the policy is testable without a network, a
 * registry, or an install — which is the only way a supply-chain gate gets
 * exercised at all between real advisories.
 *
 * @param {object} report parsed `npm audit --json` output
 * @param {{allowlist?: object[], reviewBy?: string, today?: string}} [options]
 */
export function evaluateAuditReport(report, options = {}) {
  const allowlist = options.allowlist ?? ALLOWED_ADVISORIES;
  const reviewBy = options.reviewBy ?? REVIEW_BY;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const byUrl = new Map(allowlist.map((entry) => [entry.url, entry]));

  const vulnerabilities = report?.vulnerabilities ?? {};
  const seenUrls = new Set();

  /** Distinct advisory URLs per severity — the number the comment conflates. */
  const advisoryUrlsBySeverity = new Map(SEVERITY_ORDER.map((s) => [s, new Set()]));
  /** Vulnerable PACKAGES per severity — the other number. */
  const packageCounts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

  const allowed = [];
  const unlisted = [];
  /** Allowlisted advisories found on a node path they were not declared for. */
  const offChain = [];
  /** Packages at/above the gate floor, for the report header. */
  const gated = [];
  /** Distinct advisory URLs at/above the gate floor. The other count. */
  const gatedAdvisoryUrls = new Set();

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const severity = String(vuln?.severity ?? "unknown");
    if (severity in packageCounts) packageCounts[severity] += 1;
    const nodes = Array.isArray(vuln?.nodes) ? vuln.nodes : [];

    // `via` entries are either an advisory object (this package carries the
    // advisory) or a string (this package merely depends on one that does). Only
    // the former names an advisory URL.
    const advisories = (vuln?.via ?? []).filter(
      (via) => via && typeof via === "object" && typeof via.url === "string",
    );

    // Recorded per PACKAGE, not per advisory. Three of the five high packages
    // in this tree — passkey-kit, relayer-plugin-channels and the nested
    // stellar-sdk — carry no advisory of their own, because they only depend on
    // one. They are still high, still part of the chain, and still belong in
    // the count.
    if (GATE_SEVERITIES.has(severity)) {
      gated.push({
        name,
        severity,
        nodes,
        isDirect: vuln?.isDirect === true,
        advisoryUrls: advisories.map((a) => a.url),
      });
    }

    for (const advisory of advisories) {
      // Counted DISTINCTLY. `npm audit` reports the same advisory once per
      // package that carries it, so a naive count double-counts anything a
      // wrapper and its dependency both report — Vitest's GHSA-82fw appears on
      // both `vitest` and `@vitest/mocker` and is one advisory, not two.
      advisoryUrlsBySeverity.get(advisory.severity)?.add(advisory.url);
      seenUrls.add(advisory.url);

      const atFloor = GATE_SEVERITIES.has(severity) || GATE_SEVERITIES.has(advisory.severity);
      if (atFloor) gatedAdvisoryUrls.add(advisory.url);

      const record = { name, url: advisory.url, severity, nodes };
      const entry = byUrl.get(advisory.url);
      if (!entry) {
        // Below the gate floor: noted, not fatal. The repo's floor is `high`,
        // and silently failing on a new moderate would train everyone to ignore
        // the gate.
        if (atFloor) unlisted.push(record);
        continue;
      }

      allowed.push({ ...record, reason: entry.reason, productionPath: entry.productionPath === true });

      const unexpected = nodes.filter((node) => !(entry.expectedNodes ?? []).includes(node));
      if (unexpected.length > 0) {
        offChain.push({
          name,
          url: advisory.url,
          expected: entry.expectedNodes,
          found: unexpected,
        });
      }
    }
  }

  // An allowlisted advisory that is no longer reported is a FIX upstream. It
  // stays on the list only if someone chooses to, and the verdict says so out
  // loud instead of letting a resolved risk keep reading as an open one.
  const resolvedUpstream = allowlist
    .filter((entry) => !seenUrls.has(entry.url))
    .map((entry) => ({ url: entry.url, title: entry.title, vulnerableRange: entry.vulnerableRange }));

  const expired = today > reviewBy;

  return {
    ok: unlisted.length === 0 && offChain.length === 0 && !expired,
    expired,
    reviewBy,
    today,
    packageCounts,
    advisoryCounts: Object.fromEntries(
      SEVERITY_ORDER.map((s) => [s, advisoryUrlsBySeverity.get(s).size]),
    ),
    /** Counted, not asserted: high packages vs high advisories. */
    countReconciliation: {
      gatedPackages: gated.length,
      gatedAdvisories: gatedAdvisoryUrls.size,
      note:
        "A package count and an advisory count are different numbers: one " +
        "vulnerable package can carry several advisories, and several packages " +
        "can share one. Report both rather than writing one number in a comment.",
    },
    gated,
    allowed,
    unlisted,
    offChain,
    resolvedUpstream,
  };
}

/** Render a verdict as the lines a maintainer reads in CI. */
export function formatVerdict(verdict) {
  const counts = verdict.packageCounts;
  const advisories = verdict.advisoryCounts;
  const lines = [
    `npm audit: ${counts.critical} critical, ${counts.high} high, ` +
      `${counts.moderate} moderate, ${counts.low} low (vulnerable packages)`,
    `distinct advisories: ${advisories.critical} critical, ${advisories.high} high, ` +
      `${advisories.moderate} moderate, ${advisories.low} low`,
    // The two numbers a comment cannot keep straight: five vulnerable PACKAGES
    // carrying three high ADVISORIES is not a contradiction, it is two counts.
    `at the gate floor: ${verdict.countReconciliation.gatedPackages} package(s), ` +
      `${verdict.countReconciliation.gatedAdvisories} advisory/advisories — ` +
      `${verdict.allowed.length} allowlisted, ${verdict.unlisted.length} unlisted`,
  ];

  if (verdict.expired) {
    lines.push(
      `::error::the allowlist review checkpoint (${verdict.reviewBy}) has passed ` +
        `(today is ${verdict.today}). Re-check each advisory, then remove the ` +
        `entry or extend the date with a fresh reason.`,
    );
  }
  for (const u of verdict.unlisted) {
    lines.push(`::error::${u.severity} ${u.name} — ${u.url}`);
  }
  for (const o of verdict.offChain) {
    lines.push(
      `::error::${o.name}: allowlisted advisory ${o.url} appears on ` +
        `${o.found.join(", ")}, which is not the recorded chain (${o.expected.join(", ")}).`,
    );
  }
  for (const r of verdict.resolvedUpstream) {
    lines.push(
      `::warning::${r.url} is allowlisted but no longer reported — upstream appears ` +
        `to have fixed it. Remove the entry.`,
    );
  }
  return lines;
}

/** GitHub Actions reads workflow commands from either stream; errors go to stderr. */
function emit(lines) {
  for (const line of lines) {
    if (line.startsWith("::error::")) console.error(line);
    else console.log(line);
  }
}

// The same direct-invocation guard `validate-changeset.mjs` uses, so importing
// this module from a test does not shell out to npm.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything, so a throw is the
    // normal "there are findings" path, not a crash. The JSON is on stdout.
    raw = err?.stdout;
  }
  if (!raw) {
    console.error("::error::npm audit --json produced no output");
    process.exit(1);
  }
  const verdict = evaluateAuditReport(JSON.parse(String(raw)));
  emit(formatVerdict(verdict));
  process.exit(verdict.ok ? 0 : 1);
}
