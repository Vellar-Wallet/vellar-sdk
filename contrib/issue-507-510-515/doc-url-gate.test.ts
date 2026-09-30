import { describe, expect, it } from "vitest";
import {
  auditShippedDefaults,
  buildReport,
  collectReferences,
  EXCLUDED_PATH,
  extractUrls,
  formatReport,
  isPassingStatus,
  isScannablePath,
  knownDefaultHosts,
  OWNED_HOSTS,
  planChecks,
  probeTargetFor,
  SCAN_TARGETS,
  SHIPPED_DEFAULTS,
  THIRD_PARTY_DEFAULT_HOSTS,
} from "./doc-url-gate.mjs";

const ownedTable = new Map(OWNED_HOSTS.map((h) => [h.host, h]));
const knownHosts = knownDefaultHosts();

describe("the scan surface (#507)", () => {
  it("enumerates the trees the old scan skipped", () => {
    // The original incident was doc rot, and `SCAN_DIRS` in
    // scripts/verify-doc-urls.mjs stopped at `scripts`. A URL documented only in
    // the root README, in docs/, or in a contrib module was never checked.
    for (const target of ["contrib", "docs", "README.md", "CONTRIBUTING.md"]) {
      expect(SCAN_TARGETS, target).toContain(target);
    }
  });

  it("excludes test fixtures, which were being dialled", () => {
    // Every `https://res.test/paid` in the suite is a literal that was never
    // meant to be requested, and each one competed for a six-way pool shared
    // with real endpoints.
    for (const fixture of [
      "src/x402-client.test.ts",
      "packages/mcp-x402-payer/test/helpers.ts",
      "contrib/foo.test.ts",
      "packages/cli/src/commands/__fixtures__/challenge.ts",
      "src/types.d.ts",
    ]) {
      expect(isScannablePath(fixture), fixture).toBe(false);
    }
  });

  it("still scans the files that carry real documentation", () => {
    for (const real of [
      "website/content/docs/upto.md",
      "packages/cli/src/commands/pay.ts",
      "src/config.ts",
      "README.md",
      "docs/security-audit.md",
      "contrib/issue-507-510-515/doc-url-gate.mjs",
    ]) {
      expect(isScannablePath(real), real).toBe(true);
    }
  });

  it("matches fixture paths on a boundary, not mid-word", () => {
    // `contest.md` contains "test" but is not a fixture directory.
    expect(EXCLUDED_PATH.test("website/content/docs/contest.md")).toBe(false);
    expect(EXCLUDED_PATH.test("src/latest.ts")).toBe(false);
  });
});

describe("extractUrls (#507)", () => {
  it("finds every occurrence and trims trailing sentence punctuation", () => {
    const text = "See https://a.test/x, then https://b.test/y. Also https://c.test/z;";
    expect(extractUrls(text)).toEqual(["https://a.test/x", "https://b.test/y", "https://c.test/z"]);
  });

  it("does not run past a closing bracket or quote", () => {
    expect(extractUrls('call fetch("https://a.test/p")')).toEqual(["https://a.test/p"]);
    expect(extractUrls("see [https://a.test/p]")).toEqual(["https://a.test/p"]);
  });

  it("returns nothing for prose with no URL", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });
});

describe("collectReferences — the report names the file (#507)", () => {
  it("maps each URL to every file that mentions it", () => {
    const refs = collectReferences([
      { file: "website/content/docs/facilitator.md", text: "curl https://a.test/supported" },
      { file: "README.md", text: "curl https://a.test/supported and https://b.test/health" },
      { file: "src/config.ts", text: "https://a.test/supported" },
    ]);
    expect(refs.get("https://a.test/supported")).toEqual([
      "website/content/docs/facilitator.md",
      "README.md",
      "src/config.ts",
    ]);
    expect(refs.get("https://b.test/health")).toEqual(["README.md"]);
  });

  it("deduplicates a URL repeated inside one file", () => {
    const refs = collectReferences([{ file: "a.md", text: "https://a.test/x https://a.test/x" }]);
    expect(refs.get("https://a.test/x")).toEqual(["a.md"]);
  });
});

describe("shipped defaults — drift is a failure, not a warning (#507)", () => {
  const read = (map: Record<string, string>) => async (file: string) => map[file];

  it("confirms every default this tree actually ships", async () => {
    // The old table pinned 2 of 11. The three Stellar endpoints and the SDK's
    // own network config were unchecked, and a stale constant is a live bug
    // rather than a stale doc: the tool dials it without the reader typing it.
    const files = [
      "packages/mcp-x402-payer/src/pay-and-call.ts",
      "packages/cli/src/commands/search.ts",
      "packages/cli/src/commands/pay.ts",
      "packages/mcp-x402-payer/src/signer.ts",
      "packages/cli/src/commands/inspect.ts",
      "src/config.ts",
    ];
    const map: Record<string, string> = {};
    for (const file of files) map[file] = SHIPPED_DEFAULTS.filter((d) => d.file === file).map((d) => d.url).join("\n");

    const { drift, confirmed } = await auditShippedDefaults(SHIPPED_DEFAULTS, read(map), knownHosts);
    expect(drift).toEqual([]);
    expect(confirmed).toHaveLength(SHIPPED_DEFAULTS.length);
    // And it really is more than the two the current table covers.
    expect(confirmed.length).toBeGreaterThan(2);
  });

  it("accepts a declared third-party default without gating it", () => {
    // Stellar runs the public Soroban RPC and Horizon endpoints. Shipping them
    // is correct, and their uptime is not this repo's to gate on.
    for (const host of THIRD_PARTY_DEFAULT_HOSTS) {
      expect(knownHosts.has(host), host).toBe(true);
    }
    const targets = planChecks(
      new Map(),
      [{ file: "src/config.ts", url: `https://${THIRD_PARTY_DEFAULT_HOSTS[0]}` }],
      ownedTable,
    );
    expect(targets[0]!.gating).toBe(false);
  });

  it("fails when a default no longer matches its file", async () => {
    const { drift } = await auditShippedDefaults(
      [{ file: "src/config.ts", url: "https://soroban-testnet.stellar.org" }],
      read({ "src/config.ts": "export const rpcUrl = 'https://soroban-testnet.stellarr.org';" }),
      knownHosts,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]!.reason).toContain("no longer present");
  });

  it("fails when a default is repointed at a host nobody declared", async () => {
    // The one that matters. Gating is keyed on HOST, so editing a default's host
    // demotes it from "fails the build" to "third-party, ignored" without anyone
    // deciding that. Being third-party is fine; being UNDECLARED is not.
    const { drift } = await auditShippedDefaults(
      [{ file: "src/config.ts", url: "https://facilitator.evil.example" }],
      read({ "src/config.ts": "const u = 'https://facilitator.evil.example';" }),
      knownHosts,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]!.reason).toContain("declared nowhere");
  });

  it("reports a missing file rather than skipping it silently", async () => {
    const { drift } = await auditShippedDefaults(
      [{ file: "src/gone.ts", url: "https://a.test" }],
      read({}),
      knownHosts,
    );
    expect(drift[0]!.reason).toBe("file not found");
  });
});

describe("probeTargetFor (#507)", () => {
  it("probes an owned host at the path the docs tell a reader to call", () => {
    // The facilitator answers /supported and 404s at /, so probing the root
    // would report a healthy service as dead.
    const target = probeTargetFor("https://vellar-facilitator-production.up.railway.app/x402", ownedTable)!;
    expect(target.url).toBe("https://vellar-facilitator-production.up.railway.app/supported");
    expect(target.gating).toBe(true);
  });

  it("keeps the documented path for a third-party host", () => {
    const target = probeTargetFor("https://stellar.org/explorer", ownedTable)!;
    expect(target.url).toBe("https://stellar.org/explorer");
    expect(target.gating).toBe(false);
  });

  it("marks the explorer as tolerating a 404 at the root", () => {
    const target = probeTargetFor("https://vellar-explorer-production.up.railway.app", ownedTable)!;
    expect(target.allow404).toBe(true);
  });

  it("returns undefined for something that is not a URL at all", () => {
    // WHATWG URL is lenient — `https:/broken` parses to `https://broken/` — so
    // the guard has to be a literal it cannot parse at all.
    expect(probeTargetFor("not a url", ownedTable)).toBeUndefined();
  });
});

describe("isPassingStatus — 402 is a correct response (#507)", () => {
  it("treats 402 as success, because it is the answer for a paid route", () => {
    expect(isPassingStatus(402, false)).toBe(true);
  });

  it("treats every 2xx as success", () => {
    for (const status of [200, 201, 204, 299]) expect(isPassingStatus(status, false)).toBe(true);
  });

  it("fails a 4xx or 5xx that is not 402", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      expect(isPassingStatus(status, false), String(status)).toBe(false);
    }
  });

  it("tolerates 404 only where the host is declared to serve no root page", () => {
    expect(isPassingStatus(404, true)).toBe(true);
    expect(isPassingStatus(404, false)).toBe(false);
  });
});

describe("planChecks (#507)", () => {
  it("merges references to the same target and ORs gating", () => {
    const checks = planChecks(
      new Map([
        ["https://vellar-facilitator-production.up.railway.app", ["a.md"]],
        ["https://vellar-facilitator-production.up.railway.app/supported", ["b.md"]],
      ]),
      [],
      ownedTable,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.url).toBe("https://vellar-facilitator-production.up.railway.app/supported");
    expect(checks[0]!.files).toEqual(["a.md", "b.md"]);
    expect(checks[0]!.gating).toBe(true);
  });

  it("probes a shipped default even when no doc mentions it", () => {
    const checks = planChecks(
      new Map(),
      [{ file: "src/config.ts", url: "https://soroban-testnet.stellar.org" }],
      ownedTable,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.files).toEqual(["src/config.ts (shipped default)"]);
  });

  it("drops a regex false positive that is not a URL", () => {
    expect(planChecks(new Map([["not a url", ["a.md"]]]), [], ownedTable)).toEqual([]);
  });
});

describe("buildReport — report precisely, fail only on what the repo controls (#507)", () => {
  const checks = [
    { url: "https://owned.test/health", gating: true, allow404: false, files: ["a.md", "b.md"] },
    { url: "https://thirdparty.test/x", gating: false, allow404: false, files: ["c.md"] },
  ];

  it("fails only on a repo-operated host", () => {
    const report = buildReport(checks, new Map([
      ["https://owned.test/health", { ok: false, status: 0, error: "timeout" }],
      ["https://thirdparty.test/x", { ok: false, status: 502 }],
    ]));
    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.notices).toHaveLength(1);
  });

  it("passes when only a third-party URL is down", () => {
    // A third-party outage is not this repository's fault, and a per-PR gate on
    // it would let someone else's downtime block an unrelated merge.
    const report = buildReport(checks, new Map([
      ["https://owned.test/health", { ok: true, status: 200 }],
      ["https://thirdparty.test/x", { ok: false, status: 502 }],
    ]));
    expect(report.ok).toBe(true);
    expect(report.notices).toHaveLength(1);
  });

  it("names each failing URL and the files that reference it", () => {
    const report = buildReport(checks, new Map([
      ["https://owned.test/health", { ok: false, status: 0, error: "getaddrinfo ENOTFOUND" }],
      ["https://thirdparty.test/x", { ok: true, status: 200 }],
    ]));
    const out = formatReport(report).join("\n");
    expect(out).toContain("https://owned.test/health");
    expect(out).toContain("getaddrinfo ENOTFOUND");
    expect(out).toContain("a.md, b.md");
  });

  it("marks a third-party failure as a non-gating warning in the output", () => {
    const report = buildReport(checks, new Map([
      ["https://owned.test/health", { ok: true, status: 200 }],
      ["https://thirdparty.test/x", { ok: false, status: 500 }],
    ]));
    const out = formatReport(report).join("\n");
    expect(out).toContain("::warning::");
    expect(out).toContain("third-party; not gating");
    expect(out).not.toContain("repo-operated URL(s) are unreachable");
  });
});

describe("the tables match the tree (#507)", () => {
  it("declares every host this repo operates exactly once", () => {
    expect(ownedTable.size).toBe(OWNED_HOSTS.length);
  });

  it("keeps the third-party default hosts out of the owned set", () => {
    // The two lists answer different questions: "who do we operate" (gating) and
    // "who do we ship a default for" (checked, not gated). Conflating them is
    // how Stellar's uptime ends up blocking an unrelated merge.
    for (const host of THIRD_PARTY_DEFAULT_HOSTS) {
      expect(ownedTable.has(host), host).toBe(false);
      expect(knownHosts.has(host), host).toBe(true);
    }
  });

  it("points each owned host at a path, not at the origin", () => {
    for (const host of OWNED_HOSTS) {
      expect(host.probePath, host.host).toMatch(/^\//);
    }
  });

  it("pins each shipped default to a file inside the tree", () => {
    for (const entry of SHIPPED_DEFAULTS) {
      expect(entry.file, entry.url).toMatch(/^(src|packages|scripts)\//);
      expect(entry.url).toMatch(/^https:\/\//);
    }
  });

  it("covers the facilitator, the RPC endpoints and the SDK's own config", () => {
    const files = new Set(SHIPPED_DEFAULTS.map((d) => d.file));
    expect(files.has("src/config.ts")).toBe(true);
    expect(files.has("packages/mcp-x402-payer/src/signer.ts")).toBe(true);
    expect(files.has("packages/cli/src/commands/inspect.ts")).toBe(true);
    expect(files.has("packages/cli/src/commands/pay.ts")).toBe(true);
  });
});
