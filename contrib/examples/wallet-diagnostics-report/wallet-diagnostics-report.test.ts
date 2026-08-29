import { describe, expect, it } from "vitest";
import { createMockWallet, formatReport, runDiagnostics } from "./wallet-diagnostics-report";

describe("runDiagnostics", () => {
  it("includes at least four distinct checks", async () => {
    const wallet = createMockWallet("testnet");
    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => true });
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    expect(new Set(report.checks.map((c) => c.name)).size).toBe(report.checks.length); // all distinct
  });

  it("fails the session checks before the wallet is connected", async () => {
    const wallet = createMockWallet("testnet");
    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => true });

    expect(report.allPassed).toBe(false);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName["Session exists"]?.passed).toBe(false);
    expect(byName["Session connected"]?.passed).toBe(false);
  });

  it("passes every check once the wallet is created and network matches", async () => {
    const wallet = createMockWallet("testnet");
    await wallet.create();

    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => true });

    expect(report.allPassed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails the network check when expectedNetwork does not match the session", async () => {
    const wallet = createMockWallet("testnet");
    await wallet.create();

    const report = await runDiagnostics({ wallet, expectedNetwork: "mainnet", pingBackend: async () => true });

    const networkCheck = report.checks.find((c) => c.name === "Network matches expected");
    expect(networkCheck?.passed).toBe(false);
    expect(networkCheck?.reason).toMatch(/testnet.*mainnet/);
  });

  it("fails the backend check with a reason when the ping returns false", async () => {
    const wallet = createMockWallet("testnet");
    await wallet.create();

    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => false });

    const backendCheck = report.checks.find((c) => c.name === "Backend reachable");
    expect(backendCheck?.passed).toBe(false);
    expect(backendCheck?.reason).toMatch(/returned false/);
  });

  it("fails the backend check with a reason when the ping throws", async () => {
    const wallet = createMockWallet("testnet");
    await wallet.create();

    const report = await runDiagnostics({
      wallet,
      expectedNetwork: "testnet",
      pingBackend: async () => {
        throw new Error("connection refused");
      },
    });

    const backendCheck = report.checks.find((c) => c.name === "Backend reachable");
    expect(backendCheck?.passed).toBe(false);
    expect(backendCheck?.reason).toMatch(/connection refused/);
  });
});

describe("formatReport", () => {
  it("separates passing and failing checks into distinct sections", async () => {
    const wallet = createMockWallet("testnet");
    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => true });

    const text = formatReport(report);

    expect(text).toContain("Passing:");
    expect(text).toContain("Failing:");
    expect(text).toContain("✓ Backend reachable");
    expect(text).toContain("✗ Session exists — No active session");
  });

  it("omits the Failing section entirely when everything passed", async () => {
    const wallet = createMockWallet("testnet");
    await wallet.create();
    const report = await runDiagnostics({ wallet, expectedNetwork: "testnet", pingBackend: async () => true });

    const text = formatReport(report);

    expect(text).not.toContain("Failing:");
  });
});
