import { describe, expect, it } from "vitest";
import {
  ALLOWED_ADVISORIES,
  formatVerdict,
  evaluateAuditReport,
  LAST_RECHECKED,
  RESOLUTION_PLAN,
  REVIEW_BY,
} from "./audit-advisory-policy.mjs";

/**
 * The real `npm audit --json` output for this tree, captured 2026-09-30
 * (LAST_RECHECKED), trimmed only to the fields the policy reads. All 13
 * vulnerable packages are present, because the severity counts are part of what
 * is being asserted: the `metadata.vulnerabilities` block at the bottom is
 * copied from npm and the entries above must add up to it.
 */
function liveReport(): Record<string, unknown> {
  return {
    vulnerabilities: {
      "passkey-kit": {
        name: "passkey-kit",
        severity: "high",
        isDirect: true,
        range: "0.12.0 - 0.18.0",
        nodes: ["node_modules/passkey-kit"],
        via: ["dep:@openzeppelin/relayer-plugin-channels"],
      },
      "@openzeppelin/relayer-plugin-channels": {
        name: "@openzeppelin/relayer-plugin-channels",
        severity: "high",
        isDirect: false,
        range: "<=0.20.0",
        nodes: ["node_modules/@openzeppelin/relayer-plugin-channels"],
        via: ["dep:@stellar/stellar-sdk"],
      },
      "@stellar/stellar-sdk": {
        name: "@stellar/stellar-sdk",
        severity: "high",
        isDirect: false,
        range: "<=15.1.0",
        nodes: ["node_modules/@openzeppelin/relayer-plugin-channels/node_modules/@stellar/stellar-sdk"],
        via: ["dep:toml"],
      },
      toml: {
        name: "toml",
        severity: "high",
        isDirect: false,
        range: "<=4.1.2",
        nodes: ["node_modules/toml"],
        via: [
          {
            name: "toml",
            severity: "high",
            title: "toml-node: Uncontrolled Recursion",
            url: "https://github.com/advisories/GHSA-82x6-q7mm-w9cf",
            range: "<4.2.0",
          },
          {
            name: "toml",
            severity: "high",
            title: "toml-node: Prototype Pollution",
            url: "https://github.com/advisories/GHSA-v5mp-jgw5-2x6j",
            range: "<4.1.2",
          },
        ],
      },
      "smol-toml": {
        name: "smol-toml",
        severity: "high",
        isDirect: false,
        range: "<=1.7.0",
        nodes: ["node_modules/smol-toml"],
        via: [
          {
            name: "smol-toml",
            severity: "high",
            title: "smol-toml: Denial of Service via malformed TOML documents",
            url: "https://github.com/advisories/GHSA-7w5x-hrqm-74c2",
            range: "<=1.7.0",
          },
        ],
      },
      "@vitest/mocker": {
        name: "@vitest/mocker",
        severity: "moderate",
        isDirect: false,
        range: "2.1.0 - 4.1.10",
        nodes: ["node_modules/@vitest/mocker"],
        via: [
          {
            name: "@vitest/mocker",
            severity: "moderate",
            title: "Vitest: Path Traversal / Arbitrary File Read via Redirect Mock",
            url: "https://github.com/advisories/GHSA-82fw-gwwq-j7x9",
            range: ">=2.1.0 <4.1.11",
          },
        ],
      },
      ajv: {
        name: "ajv",
        severity: "moderate",
        isDirect: false,
        nodes: ["node_modules/ajv"],
        via: ["dep:fast-uri"],
      },
      esbuild: {
        name: "esbuild",
        severity: "low",
        isDirect: false,
        range: "0.27.3 - 0.28.0",
        nodes: ["node_modules/esbuild"],
        via: [
          {
            name: "esbuild",
            severity: "low",
            title: "esbuild allows arbitrary file read on Windows",
            url: "https://github.com/advisories/GHSA-g7r4-m6w7-qqqr",
            range: ">=0.27.3 <0.28.1",
          },
        ],
      },
      "fast-uri": {
        name: "fast-uri",
        severity: "moderate",
        isDirect: false,
        range: "3.0.0 - 3.1.7",
        nodes: ["node_modules/ajv/node_modules/fast-uri"],
        via: [
          {
            name: "fast-uri",
            severity: "moderate",
            title: "fast-uri vulnerable to inconsistent host case normalization",
            url: "https://github.com/advisories/GHSA-hrr3-gc8f-f4qj",
            range: ">=3.0.0 <3.1.8",
          },
        ],
      },
      hono: {
        name: "hono",
        severity: "moderate",
        isDirect: false,
        nodes: ["node_modules/hono"],
        via: [
          {
            name: "hono",
            severity: "moderate",
            title: "Hono: Incomplete fix for CVE-2026-39408",
            url: "https://github.com/advisories/GHSA-gqvv-2mrq-wpjv",
            range: "<4.13.5",
          },
          {
            name: "hono",
            severity: "moderate",
            title: "Hono: Unbounded dot-notation nesting in parseBody()",
            url: "https://github.com/advisories/GHSA-g6gw-c38x-mqfc",
            range: "<4.13.5",
          },
          {
            name: "hono",
            severity: "moderate",
            title: "Hono: Query parser reads parameters after the URL fragment",
            url: "https://github.com/advisories/GHSA-crvj-82cr-hjcx",
            range: "<4.13.5",
          },
        ],
      },
      "ip-address": {
        name: "ip-address",
        severity: "moderate",
        isDirect: false,
        range: "<=10.7.0",
        nodes: ["node_modules/ip-address"],
        via: [
          {
            name: "ip-address",
            severity: "moderate",
            title: "Address6.isLinkLocal() recognizes fe80::/64",
            url: "https://github.com/advisories/GHSA-rpw4-54j3-4h4q",
            range: "<=10.5.0",
          },
          {
            name: "ip-address",
            severity: "moderate",
            title: "no classifier recognizes the NAT64 local-use range",
            url: "https://github.com/advisories/GHSA-2vr4-cq9g-pvrc",
            range: ">=10.2.0 <=10.5.0",
          },
          {
            name: "ip-address",
            severity: "moderate",
            title: "isInSubnet() and isHostInSubnet() compare address families",
            url: "https://github.com/advisories/GHSA-j6r3-76f7-8jcv",
            range: "<=10.7.0",
          },
          {
            name: "ip-address",
            severity: "moderate",
            title: "Address6 builds an unbounded parse diagnostic",
            url: "https://github.com/advisories/GHSA-h3mg-xc3c-68pw",
            range: "<=10.7.0",
          },
        ],
      },
      qs: {
        name: "qs",
        severity: "moderate",
        isDirect: false,
        range: "2.2.5 - 6.15.3",
        nodes: ["node_modules/qs"],
        via: [
          {
            name: "qs",
            severity: "moderate",
            title: "qs array-limit bypass via bracket-key comma parsing",
            url: "https://github.com/advisories/GHSA-x5fp-wj9c-mxmx",
            range: ">=6.14.2 <=6.15.3",
          },
          {
            name: "qs",
            severity: "moderate",
            title: "qs: Denial of Service via Attacker Controlled isBuffer",
            url: "https://github.com/advisories/GHSA-4mjr-xmp4-gh2g",
            range: ">=2.2.5 <6.16.0",
          },
        ],
      },
      vitest: {
        name: "vitest",
        severity: "moderate",
        isDirect: true,
        range: "2.1.0-beta.1 - 4.1.10",
        nodes: ["node_modules/vitest"],
        via: [
          "dep:@vitest/mocker",
          {
            name: "vitest",
            severity: "moderate",
            title: "Vitest: Path Traversal / Arbitrary File Read via Redirect Mock",
            url: "https://github.com/advisories/GHSA-82fw-gwwq-j7x9",
            range: ">=2.1.0 <4.1.11",
          },
        ],
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 7, high: 5, critical: 0, total: 13 } },
  };
}

describe("evaluateAuditReport — the live tree (#515)", () => {
  const verdict = evaluateAuditReport(liveReport(), { today: LAST_RECHECKED });

  it("agrees with npm's own metadata block, entry by entry", () => {
    // Self-check on the fixture: the counts the policy computes are only
    // meaningful if the fixture is the whole report. If a future edit trims an
    // entry, this fails instead of quietly making every count below smaller.
    const report = liveReport();
    const meta = (report.metadata as { vulnerabilities: Record<string, number> }).vulnerabilities;
    expect(verdict.packageCounts).toMatchObject({
      critical: meta.critical,
      high: meta.high,
      moderate: meta.moderate,
      low: meta.low,
    });
    expect(Object.keys(report.vulnerabilities as object)).toHaveLength(meta.total);
  });

  it("passes: every high is on the named allowlist", () => {
    expect(verdict.ok).toBe(true);
    expect(verdict.unlisted).toEqual([]);
    expect(verdict.offChain).toEqual([]);
  });

  it("reconciles the two counts the inline comment conflates", () => {
    // Five vulnerable PACKAGES at the gate floor, carrying three distinct
    // high ADVISORIES. The header of scripts/audit-gate.mjs says "all five
    // highs" next to a three-URL ALLOWED list; both are right about different
    // things, which is exactly why the number has to be computed.
    expect(verdict.packageCounts.high).toBe(5);
    expect(verdict.advisoryCounts.high).toBe(3);
    expect(verdict.countReconciliation.gatedPackages).toBe(5);
    expect(verdict.countReconciliation.gatedAdvisories).toBe(3);
  });

  it("counts advisories distinctly, not once per carrying package", () => {
    // Vitest's GHSA-82fw is reported on both `vitest` and `@vitest/mocker`. It is
    // one advisory; a naive count would report it twice and every total derived
    // from it would be wrong.
    const report = liveReport();
    const ids = (report.vulnerabilities as Record<string, { via: unknown[] }>);
    expect(
      ids["@vitest/mocker"].via.filter((v) => typeof v === "object").length,
    ).toBeGreaterThan(0);
    expect(verdict.advisoryCounts.moderate).toBe(11);
    // 12 (package, advisory) pairs collapse to 11 distinct URLs.
    const pairs = Object.values(ids).reduce(
      (n, v) => n + v.via.filter((x) => typeof x === "object").length,
      0,
    );
    expect(pairs).toBeGreaterThan(verdict.advisoryCounts.moderate);
  });

  it("totals 13 vulnerable packages and 15 distinct advisories", () => {
    const packages = Object.values(verdict.packageCounts).reduce((a, b) => a + b, 0);
    const advisories = Object.values(verdict.advisoryCounts).reduce((a, b) => a + b, 0);
    expect(packages).toBe(13);
    expect(advisories).toBe(15);
  });

  it("records the current upstream status, including the drift in the moderates", () => {
    // The issue was filed against "5 high, 4 moderate, 1 low". As of
    // 2026-09-30 the moderates have gone 4 → 7 (hono, ip-address, qs) while the
    // highs are unchanged at 5. The floor is `high`, so the gate still passes —
    // but the count moving is exactly the kind of thing a stale comment hides.
    expect(verdict.packageCounts.moderate).toBeGreaterThan(4);
    expect(verdict.packageCounts.low).toBe(1);
    expect(verdict.packageCounts.critical).toBe(0);
  });

  it("marks the smol-toml advisory as production-path, not part of the dev chain", () => {
    const smol = verdict.allowed.find((a) => a.url.endsWith("GHSA-7w5x-hrqm-74c2"));
    expect(smol).toBeDefined();
    // It sits at the ROOT node path, `dev: false` in the lockfile, reached from
    // the production @stellar/stellar-sdk@16.2.0. The recorded reason in
    // scripts/audit-gate.mjs calls it transitive of stellar-sdk ≤15.x, which is
    // wrong: the ≤15.x copy is dev-only and does not depend on smol-toml.
    expect(smol!.productionPath).toBe(true);
    expect(smol!.nodes).toEqual(["node_modules/smol-toml"]);

    const toml = verdict.allowed.find((a) => a.url.endsWith("GHSA-82x6-q7mm-w9cf"));
    expect(toml!.productionPath).toBe(false);
  });
});

describe("evaluateAuditReport — new highs are not silently admitted (#515)", () => {
  it("fails on a high advisory outside the allowlist", () => {
    const report = liveReport();
    (report.vulnerabilities as Record<string, unknown>)["left-pad"] = {
      name: "left-pad",
      severity: "high",
      nodes: ["node_modules/left-pad"],
      via: [
        {
          name: "left-pad",
          severity: "high",
          title: "something new",
          url: "https://github.com/advisories/GHSA-newly-discovered",
          range: "<2.0.0",
        },
      ],
    };
    const verdict = evaluateAuditReport(report, { today: LAST_RECHECKED });
    expect(verdict.ok).toBe(false);
    expect(verdict.unlisted).toHaveLength(1);
    expect(verdict.unlisted[0]!.name).toBe("left-pad");
    expect(verdict.unlisted[0]!.url).toBe("https://github.com/advisories/GHSA-newly-discovered");
  });

  it("fails on a critical too, not just a high", () => {
    const report = liveReport();
    (report.vulnerabilities as Record<string, unknown>)["evil"] = {
      name: "evil",
      severity: "critical",
      nodes: ["node_modules/evil"],
      via: [{ name: "evil", severity: "critical", url: "https://example.test/GHSA-x", range: "*" }],
    };
    expect(evaluateAuditReport(report, { today: LAST_RECHECKED }).ok).toBe(false);
  });

  it("does not fail on a new moderate, and says so in the counts", () => {
    // The repo's floor is `high`. Failing on a new moderate would train people
    // to ignore the gate, which is how a real high gets waved through later.
    const report = liveReport();
    (report.vulnerabilities as Record<string, unknown>)["hono"] = {
      name: "hono",
      severity: "moderate",
      nodes: ["node_modules/hono"],
      via: [{ name: "hono", severity: "moderate", url: "https://example.test/GHSA-mod", range: "*" }],
    };
    const verdict = evaluateAuditReport(report, { today: LAST_RECHECKED });
    expect(verdict.ok).toBe(true);
    expect(verdict.unlisted).toEqual([]);
    expect(verdict.advisoryCounts.moderate).toBeGreaterThan(0);
  });

  it("ignores a package that only DEPENDS on a vulnerable one", () => {
    // passkey-kit, relayer-plugin-channels and the nested stellar-sdk all show
    // up as high with `via: ["dep:…"]` strings and no advisory of their own.
    // They are the chain, not three extra advisories.
    const verdict = evaluateAuditReport(liveReport(), { today: LAST_RECHECKED });
    const pk = verdict.gated.find((g) => g.name === "passkey-kit");
    expect(pk).toBeDefined();
    expect(pk!.isDirect).toBe(true);
    expect(verdict.unlisted).toEqual([]);
  });

  it("survives an empty or malformed report rather than throwing", () => {
    for (const report of [{}, { vulnerabilities: {} }, { vulnerabilities: null }]) {
      const verdict = evaluateAuditReport(report, { today: LAST_RECHECKED });
      expect(verdict.ok).toBe(true);
      expect(verdict.packageCounts.high).toBe(0);
    }
  });
});

describe("evaluateAuditReport — the allowlist is pinned to the chain (#515)", () => {
  it("fails when an allowlisted advisory appears on an undeclared node path", () => {
    // An allowlisted URL turning up somewhere else is a different exposure
    // wearing a familiar label. This is the check that would have caught the
    // smol-toml attribution being recorded as part of the dev-only toml chain.
    const report = liveReport();
    (report.vulnerabilities as Record<string, unknown>)["smol-toml"].nodes = [
      "node_modules/somewhere-else/node_modules/smol-toml",
    ];
    const verdict = evaluateAuditReport(report, { today: LAST_RECHECKED });
    expect(verdict.ok).toBe(false);
    expect(verdict.offChain).toHaveLength(1);
    expect(verdict.offChain[0]!.found).toEqual([
      "node_modules/somewhere-else/node_modules/smol-toml",
    ]);
    expect(verdict.offChain[0]!.expected).toEqual(["node_modules/smol-toml"]);
  });

  it("accepts the same advisory when it lands on a declared path", () => {
    const report = liveReport();
    (report.vulnerabilities as Record<string, unknown>)["smol-toml"].nodes = [
      "node_modules/smol-toml",
      "node_modules/smol-toml",
    ];
    expect(evaluateAuditReport(report, { today: LAST_RECHECKED }).offChain).toEqual([]);
  });

  it("surfaces an allowlisted advisory that is no longer reported as resolved", () => {
    // A fixed advisory should be visibly removable, not silently carried.
    const report = liveReport();
    delete (report.vulnerabilities as Record<string, unknown>)["smol-toml"];
    const verdict = evaluateAuditReport(report, { today: LAST_RECHECKED });
    // Still a pass — a stale entry is not a new risk.
    expect(verdict.ok).toBe(true);
    expect(verdict.resolvedUpstream.map((r) => r.url)).toEqual([
      "https://github.com/advisories/GHSA-7w5x-hrqm-74c2",
    ]);
    expect(formatVerdict(verdict).join("\n")).toContain("no longer reported");
  });
});

describe("evaluateAuditReport — the review date expires rather than persists (#515)", () => {
  it("fails once the checkpoint has passed", () => {
    const verdict = evaluateAuditReport(liveReport(), { today: "2026-12-16" });
    expect(verdict.ok).toBe(false);
    expect(verdict.expired).toBe(true);
    expect(formatVerdict(verdict).join("\n")).toContain("review checkpoint");
  });

  it("passes ON the checkpoint date, so the day itself is actionable", () => {
    const verdict = evaluateAuditReport(liveReport(), { today: REVIEW_BY });
    expect(verdict.expired).toBe(false);
    expect(verdict.ok).toBe(true);
  });

  it("carries a dated checkpoint rather than a permanent softening", () => {
    expect(REVIEW_BY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LAST_RECHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LAST_RECHECKED <= REVIEW_BY).toBe(true);
  });

  it("defaults to today when no date is supplied", () => {
    const verdict = evaluateAuditReport(liveReport());
    expect(verdict.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the allowlist data itself (#515)", () => {
  it("gives every entry a URL, a range, a reason and a declared node path", () => {
    for (const entry of ALLOWED_ADVISORIES) {
      expect(entry.url, entry.title).toMatch(/^https:\/\/github\.com\/advisories\/GHSA-/);
      expect(entry.reason.length, entry.url).toBeGreaterThan(40);
      expect(entry.reachedVia.length, entry.url).toBeGreaterThan(10);
      expect(entry.expectedNodes.length, entry.url).toBeGreaterThan(0);
    }
  });

  it("records a closable route for every allowlisted advisory", () => {
    // "Unresolved upstream" was the recorded posture. It is not true for either
    // half, and the difference is the deliverable of this re-check.
    const covered = new Set(RESOLUTION_PLAN.flatMap((p) => p.advisory.split(", ")));
    for (const entry of ALLOWED_ADVISORIES) {
      const id = entry.url.split("/").pop()!;
      expect(covered.has(id), `${id} has no recorded resolution route`).toBe(true);
    }
    expect(RESOLUTION_PLAN.every((p) => p.closable)).toBe(true);
  });

  it("proposes no major-version override inside the passkey signing path", () => {
    // The constraint the original rationale gave for the toml half, and which
    // both recorded routes respect: an in-range lockfile pin, or a MINOR bump
    // of passkey-kit that removes the chain outright.
    const smol = RESOLUTION_PLAN.find((p) => p.advisory === "GHSA-7w5x-hrqm-74c2")!;
    expect(smol.action).toContain("overrides");
    expect(smol.action).toMatch(/smol-toml/);

    const toml = RESOLUTION_PLAN.find((p) => p.advisory.includes("GHSA-82x6"))!;
    expect(toml.action).toContain("0.17.0");
    expect(toml.action).toMatch(/peer range/);
  });
});
