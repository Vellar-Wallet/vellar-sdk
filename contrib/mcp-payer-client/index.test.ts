// End-to-end and failure-mode tests for the minimal MCP client + stdio MCP payer example (#632).

import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  createThrowawayTestKeypair,
  runMcpPayerClientExample,
} from "./index";

describe("contrib/mcp-payer-client — minimal MCP client over stdio (#632)", () => {
  it("generates a valid non-production throwaway Stellar keypair at runtime", () => {
    const kp1 = createThrowawayTestKeypair();
    const kp2 = createThrowawayTestKeypair();

    expect(kp1.nonProductionTestOnly).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(kp1.publicKey)).toBe(true);
    expect(StrKey.isValidEd25519SecretSeed(kp1.secret)).toBe(true);
    expect(kp1.secret).not.toBe(kp2.secret);
  });

  it("spawns the MCP payer over stdio, completes initialize + tools/list, and pays a mocked x402 resource", async () => {
    const logs: string[] = [];
    const result = await runMcpPayerClientExample({
      maxAmount: "5000",
      sessionCeiling: "1000000",
      mockServerOptions: {
        amount: "1000",
        settlementTxLabel: "happy-path-632",
      },
      log: (line) => logs.push(line),
    });

    expect(result.serverInfo?.name).toBe("vellar-x402-payer");
    expect(result.toolNames).toEqual([
      "x402_pay",
      "x402_pay_and_call",
      "x402_quote",
      "x402_session_budget",
    ]);

    // Quote response reports the price without spending.
    expect(result.quoteText).toContain("Payment required (HTTP 402).");
    expect(result.quoteText).toContain("1000 base units");
    expect(result.quoteText).toContain("No payment was made and nothing was signed by this call.");

    // Pay response succeeds, returns a 64-hex settlement hash, and fences untrusted content.
    expect(result.payIsError).toBe(false);
    expect(result.settlementHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.payText).toContain(`Settlement transaction: ${result.settlementHash}`);
    expect(result.payText).toContain("BEGIN UNTRUSTED RESOURCE DATA");
    expect(result.payText).toContain("Ships are safe in harbor");

    // Session ledger moves by exactly 1,000 base units (1,000,000 -> 999,000 remaining).
    expect(result.budgetBeforeText).toContain("0 spent of 1000000, 1000000 remaining");
    expect(result.budgetAfterText).toContain("1000 spent of 1000000, 999000 remaining");
    expect(logs.some((l) => l.includes("NON-PRODUCTION TEST KEYPAIR"))).toBe(true);
  }, 30_000);

  it("refuses to sign when the resource price exceeds max_amount and leaves the session budget untouched", async () => {
    const result = await runMcpPayerClientExample({
      maxAmount: "500",
      sessionCeiling: "1000000",
      mockServerOptions: {
        amount: "1000",
      },
      log: () => {},
    });

    expect(result.payIsError).toBe(true);
    expect(result.settlementHash).toBeUndefined();
    expect(result.payText).toMatch(/exceeds maxAmount/);
    expect(result.budgetAfterText).toBe(result.budgetBeforeText);
  }, 30_000);

  it("rejects a malformed max_amount at the MCP protocol schema boundary without spending", async () => {
    const result = await runMcpPayerClientExample({
      maxAmount: "1e6",
      sessionCeiling: "1000000",
      mockServerOptions: {
        amount: "1000",
      },
      log: () => {},
    });

    expect(result.payIsError).toBe(true);
    expect(result.payText).toMatch(/Input validation error/);
    expect(result.payText).toMatch(/max_amount/);
    expect(result.budgetAfterText).toBe(result.budgetBeforeText);
  }, 30_000);

  it("refuses payment when the price exceeds the configured session ceiling", async () => {
    const result = await runMcpPayerClientExample({
      maxAmount: "10000",
      sessionCeiling: "500",
      mockServerOptions: {
        amount: "1000",
      },
      log: () => {},
    });

    expect(result.payIsError).toBe(true);
    expect(result.payText).toMatch(/SessionCeilingExceededError|session's ceiling/i);
    expect(result.budgetAfterText).toBe(result.budgetBeforeText);
  }, 30_000);

  it("surfaces facilitator verification rejections cleanly and never leaks secret seeds", async () => {
    const result = await runMcpPayerClientExample({
      maxAmount: "5000",
      sessionCeiling: "1000000",
      mockServerOptions: {
        amount: "1000",
        rejectPaidRetryWith: "facilitator_verify_rejected_signature",
      },
      log: () => {},
    });

    expect(result.payIsError).toBe(true);
    expect(result.payText).toContain("facilitator_verify_rejected_signature");
    // Ensure no Stellar secret seed (S...) ever appears in tool output or stderr logs.
    expect(result.payText).not.toMatch(/\bS[A-Z2-7]{55}\b/);
    expect(result.stderrOutput).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  }, 30_000);
});
