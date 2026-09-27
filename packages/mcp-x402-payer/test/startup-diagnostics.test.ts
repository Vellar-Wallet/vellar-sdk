// Machine-readable startup diagnostics test (#418).
//
// Asserts that the diagnostic line emitted at startup conforms to the
// StartupDiagnosticEvent schema, contains no key material, and is unchanged
// under redact().

import { describe, expect, it } from "vitest";
import {
  createStartupDiagnosticEvent,
  emitStartupDiagnostic,
  redact,
  registerSecret,
  type StartupDiagnosticEvent,
} from "../src/output.js";

describe("startup diagnostics (#418)", () => {
  it("creates a diagnostic event matching the schema for a hot wallet", () => {
    const event = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      assets: 2,
      smartAccount: false,
    });

    expect(event.schemaVersion).toBe(1);
    expect(event.network).toBe("testnet");
    expect(event.payer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(event.assets).toBe(2);
    expect(event.spendLimit).toBe("process-only (hot wallet)");
    expect(event.policies).toBeUndefined();

    // Machine-readable JSON roundtrip
    const serialized = JSON.stringify(event);
    const parsed: StartupDiagnosticEvent = JSON.parse(serialized);
    expect(parsed).toEqual(event);
  });

  it("creates a diagnostic event matching the schema for a smart account", () => {
    const event = createStartupDiagnosticEvent({
      network: "mainnet",
      payer: "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW",
      assets: 1,
      smartAccount: true,
      policies: 2,
    });

    expect(event.schemaVersion).toBe(1);
    expect(event.network).toBe("mainnet");
    expect(event.payer).toBe("CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW");
    expect(event.assets).toBe(1);
    expect(event.spendLimit).toBe("chain-enforced (smart account policy)");
    expect(event.policies).toBe(2);

    const serialized = JSON.stringify(event);
    const parsed: StartupDiagnosticEvent = JSON.parse(serialized);
    expect(parsed).toEqual(event);
  });

  it("contains no secrets and is unchanged by redact()", () => {
    const secret = "SB6U5C2C4K2S7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V7V";
    registerSecret(secret);

    const event = createStartupDiagnosticEvent({
      network: "testnet",
      payer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      assets: 3,
      spendLimit: "chain-enforced (smart account policy)",
      policies: 1,
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(secret);
    expect(redact(serialized)).toBe(serialized);
  });

  it("emits a machine-readable JSON log line to stderr", () => {
    let captured = "";
    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      captured += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const event = createStartupDiagnosticEvent({
        network: "stellar:testnet",
        payer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        assets: 1,
        smartAccount: false,
      });
      emitStartupDiagnostic(event);

      expect(captured).toContain('"level":"info"');
      expect(captured).toContain('"msg":"vellar x402 payer ready"');
      expect(captured).toContain('"schemaVersion":1');
      expect(captured).toContain('"spendLimit":"process-only (hot wallet)"');

      const parsed = JSON.parse(captured.trim());
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.network).toBe("stellar:testnet");
      expect(parsed.payer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
      expect(parsed.assets).toBe(1);
      expect(parsed.spendLimit).toBe("process-only (hot wallet)");
    } finally {
      process.stderr.write = originalStderr;
    }
  });
});
