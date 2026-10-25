import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { WalletNotReadyError } from "../../src/client";
import { PolicyNotDeployableError } from "../../src/policy-facade";
import { PolicyApiError } from "../../src/policy-types";
import {
  DEMO_ATTACH_TX_HASH,
  DEMO_POLICY_CONTRACT_ID,
  DEMO_WALLET_ADDRESS,
  runPolicyLifecycleExample,
} from "./index";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

describe("contrib/policy-lifecycle-node — headless policy lifecycle (#630)", () => {
  it("exits with code 0 when executed as a standalone CLI script against the mock gateway", () => {
    const cacheRoot = resolve(REPO_ROOT, "node_modules", ".cache");
    mkdirSync(cacheRoot, { recursive: true });
    const tempDir = mkdtempSync(join(cacheRoot, "vellar-policy-cli-630-"));
    const scriptOut = join(tempDir, "run-policy-lifecycle.mjs");

    try {
      buildSync({
        entryPoints: [resolve(HERE, "index.ts")],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        outfile: scriptOut,
        external: ["@stellar/stellar-sdk", "zustand"],
      });

      const proc = spawnSync(process.execPath, [scriptOut], {
        encoding: "utf8",
      });

      expect(proc.status).toBe(0);
      expect(proc.stdout).toContain("[Step 1: listTemplates]");
      expect(proc.stdout).toContain("[Step 2: generate]");
      expect(proc.stdout).toContain("[Step 3: simulate]");
      expect(proc.stdout).toContain("[Step 4: deploy]");
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on Windows.
      }
    }
  });
  it("executes listTemplates -> generate -> simulate -> deploy in sequence and logs each step", async () => {
    const result = await runPolicyLifecycleExample({ log: () => {} });

    expect(result.templates.length).toBeGreaterThanOrEqual(2);
    expect(result.generated.id).toBe("pol_spending_limit_01");
    expect(result.generated.status).toBe("generated");
    expect(result.simulation).toEqual({ ok: true, minResourceFee: "74500" });

    expect(result.deployed.contractId).toBe(DEMO_POLICY_CONTRACT_ID);
    expect(result.deployed.attachTxHash).toBe(DEMO_ATTACH_TX_HASH);
    expect(result.deployed.policy.status).toBe("deployed");

    // Verify passkey resume + attach happened in order.
    expect(result.attachCalls).toEqual([
      { step: "resume", arg: "passkey-cred-01" },
      { step: "attachPolicy", arg: DEMO_POLICY_CONTRACT_ID },
    ]);

    // Verify gateway HTTP requests occurred in the exact lifecycle order.
    expect(result.gatewayRequests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /policies/templates",
      "POST /policies/generate",
      "POST /policies/pol_spending_limit_01/simulate",
      "POST /policies/pol_spending_limit_01/deploy-instance",
      "POST /policies/deploy",
    ]);

    // Verify step-by-step instructional logging.
    expect(result.logs.some((l) => l.includes("[Step 1: listTemplates]"))).toBe(true);
    expect(result.logs.some((l) => l.includes("[Step 2: generate]"))).toBe(true);
    expect(result.logs.some((l) => l.includes("[Step 3: simulate]"))).toBe(true);
    expect(result.logs.some((l) => l.includes("[Step 4: deploy]"))).toBe(true);
  });

  it("throws WalletNotReadyError when simulate/deploy is called before wallet.connect()", async () => {
    await expect(
      runPolicyLifecycleExample({
        skipConnect: true,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(WalletNotReadyError);
  });

  it("throws PolicyNotDeployableError when policyAttach runtime is omitted", async () => {
    await expect(
      runPolicyLifecycleExample({
        omitAttachRuntime: true,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(PolicyNotDeployableError);
  });

  it("aborts before deploy when simulate() reports ok: false", async () => {
    await expect(
      runPolicyLifecycleExample({
        gatewayOptions: {
          simulateResponse: {
            ok: false,
            error: "Simulation failed: account storage footprint exceeded",
          },
        },
        log: () => {},
      }),
    ).rejects.toThrow(/Simulation failed: account storage footprint exceeded/);
  });

  it("surfaces retryable vs non-retryable PolicyApiError on gateway failures (503 vs 422)", async () => {
    // 503 attach_unconfirmed is retryable
    let err503: unknown;
    try {
      await runPolicyLifecycleExample({
        gatewayOptions: {
          recordDeployErrorStatus: 503,
          recordDeployErrorMessage: "attach_unconfirmed: transaction still pending",
        },
        log: () => {},
      });
    } catch (e) {
      err503 = e;
    }
    expect(err503).toBeInstanceOf(PolicyApiError);
    expect((err503 as PolicyApiError).status).toBe(503);
    expect((err503 as PolicyApiError).retryable).toBe(true);

    // 422 attach_mismatch is terminal (not retryable)
    let err422: unknown;
    try {
      await runPolicyLifecycleExample({
        gatewayOptions: {
          recordDeployErrorStatus: 422,
          recordDeployErrorMessage: "attach_mismatch: contractId does not match tx",
        },
        log: () => {},
      });
    } catch (e) {
      err422 = e;
    }
    expect(err422).toBeInstanceOf(PolicyApiError);
    expect((err422 as PolicyApiError).status).toBe(422);
    expect((err422 as PolicyApiError).retryable).toBe(false);
  });

  it("rejects an invalid PolicyDefinition with a 400 PolicyApiError from the gateway", async () => {
    await expect(
      runPolicyLifecycleExample({
        definition: {
          version: "1.0",
          type: "spending-limit",
          owners: [],
        },
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(PolicyApiError);
  });

  it("exports DEMO_WALLET_ADDRESS as a valid Soroban C-address", () => {
    expect(DEMO_WALLET_ADDRESS).toMatch(/^C[A-Z2-7]{55}$/);
  });
});
