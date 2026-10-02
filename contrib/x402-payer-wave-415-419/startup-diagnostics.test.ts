import { describe, expect, it } from "vitest";
import {
  createStartupDiagnosticEvent,
  formatStartupLine,
  redactSecrets,
  type StartupDiagnosticEvent,
} from "./startup-diagnostics";

const TEST_SECRET = "SDJ34VDR4Z3G3Y5QG2F37YJ7H76K4EOG3JTXK3P2D6U4XZ2D6U4XZ2D6";

describe("startup diagnostics (#418)", () => {
  it("emitted line parses and matches the declared StartupDiagnosticEvent type", () => {
    const event = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      assets: 2,
      smartAccount: true,
      policies: 1,
    });

    const line = formatStartupLine(event);
    const parsed = JSON.parse(line) as StartupDiagnosticEvent & { level: string; msg: string };

    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("vellar x402 payer ready");
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.network).toBe("testnet");
    expect(parsed.payer).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(parsed.assets).toBe(2);
    expect(parsed.spendLimit).toBe("chain-enforced (smart account policy)");
    expect(parsed.policies).toBe(1);
  });

  it("distinguishes chain-enforced from process-only spend mode", () => {
    const smartAccountEvent = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      assets: 1,
      smartAccount: true,
    });
    expect(smartAccountEvent.spendLimit).toBe("chain-enforced (smart account policy)");

    const hotWalletEvent = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      assets: 1,
      smartAccount: false,
    });
    expect(hotWalletEvent.spendLimit).toBe("process-only (hot wallet)");
  });

  it("does not leak secrets and redaction leaves diagnostic line unchanged", () => {
    const event = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      assets: 3,
      smartAccount: true,
    });

    const secrets = new Set([TEST_SECRET]);
    const cleanLine = formatStartupLine(event, secrets);
    const redactedAgain = redactSecrets(cleanLine, secrets);

    // Asserting the startup line is unchanged by redaction proves it contains nothing secret
    expect(cleanLine).toBe(redactedAgain);
    expect(cleanLine).not.toContain(TEST_SECRET);
    expect(cleanLine).not.toContain("[REDACTED]");
  });
});
