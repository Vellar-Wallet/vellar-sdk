// Smart-account path: configuration and refusal classification.
//
// The live behaviour is covered by test/integration/layer2.integration.test.ts,
// which settles a real payment and has the chain refuse an over-cap one. These
// pin the parts that must not regress silently.

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { SmartAccountAuthError } from "../src/smart-account-scheme.js";
import { ASSET_A, testEnv } from "./helpers.js";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const POLICY = "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3";

describe("smart-account configuration", () => {
  it("stays on the keypair path when no wallet is configured", () => {
    const config = loadConfig(testEnv());
    expect(config.walletAddress).toBeUndefined();
    expect(config.policies).toEqual([]);
  });

  it("selects the smart-account path when a wallet is configured", () => {
    const config = loadConfig({
      ...testEnv(),
      VELLAR_X402_WALLET: WALLET,
      VELLAR_X402_POLICIES: POLICY,
    });
    expect(config.walletAddress).toBe(WALLET);
    expect(config.policies).toEqual([POLICY]);
  });

  it("rejects a wallet address that is not a contract", () => {
    expect(() =>
      loadConfig({ ...testEnv(), VELLAR_X402_WALLET: "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU" }),
    ).toThrow(/must be a Soroban contract id/);
  });

  it("refuses policies without a wallet rather than ignoring them", () => {
    // Silently dropping them would look like layer 2 is on when it is not.
    expect(() => loadConfig({ ...testEnv(), VELLAR_X402_POLICIES: POLICY })).toThrow(ConfigError);
    expect(() => loadConfig({ ...testEnv(), VELLAR_X402_POLICIES: POLICY })).toThrow(
      /VELLAR_X402_WALLET is not/,
    );
  });

  it("rejects a malformed or duplicated policy id", () => {
    const base = { ...testEnv(), VELLAR_X402_WALLET: WALLET };
    expect(() => loadConfig({ ...base, VELLAR_X402_POLICIES: "not-a-contract" })).toThrow(
      /not a Soroban contract id/,
    );
    expect(() => loadConfig({ ...base, VELLAR_X402_POLICIES: `${POLICY},${POLICY}` })).toThrow(
      /more than once/,
    );
  });

  it("keeps the asset allowlist independent of the wallet", () => {
    const config = loadConfig({ ...testEnv(), VELLAR_X402_WALLET: WALLET });
    expect(config.allowedAssets).toContain(ASSET_A);
  });
});

describe("SmartAccountAuthError classification", () => {
  // Captured verbatim from testnet. The top-level code is the WALLET's generic
  // auth wrapper; the cause is nested. Classifying on #110 alone gets this
  // exactly backwards, which an earlier revision did.
  const overCap = `HostError: Error(Auth, InvalidAction)
   0: [Diagnostic Event] contract:CBIELTK6, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", CAFIATCE, Error(Contract, #110)]
   1: [Failed Diagnostic Event] contract:CAFIATCE, topics:[error, Error(Contract, #110)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   2: [Failed Diagnostic Event] contract:CAFIATCE, topics:[error, Error(Contract, #1)], data:["contract try_call failed", policy__, [CAFIATCE, [Ed25519, Bytes(89b1)], [[Contract, {args: [CAFIATCE, GAVU25UK, 6000000], contract: CBIELTK6, fn_name: transfer}]]]]
   3: [Failed Diagnostic Event] contract:CC24EVD6, topics:[log], data:["VM call trapped with HostError", policy__, Error(Contract, #1)]`;

  const malformed = `HostError: Error(Auth, InvalidAction)
   0: [Diagnostic Event] contract:CBIELTK6, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", CAFIATCE, Error(Contract, #110)]`;

  it("identifies a policy refusal as the on-chain budget working", () => {
    const err = new SmartAccountAuthError(overCap);
    expect(err.policyRejected).toBe(true);
    expect(err.message).toMatch(/REFUSED it/);
    expect(err.message).toMatch(/on-chain budget being enforced/);
  });

  it("tells the model a larger max_amount will not help", () => {
    // The wrong reaction to a budget refusal is to retry it bigger.
    expect(new SmartAccountAuthError(overCap).message).toMatch(
      /no retry or larger max_amount will change that/,
    );
  });

  it("does NOT classify on the top-level #110 alone", () => {
    // Both inputs carry #110; only one is a policy refusal.
    expect(new SmartAccountAuthError(overCap).policyRejected).toBe(true);
    expect(new SmartAccountAuthError(malformed).policyRejected).toBe(false);
  });

  it("points at signer configuration when no policy was invoked", () => {
    const err = new SmartAccountAuthError(malformed);
    expect(err.message).toMatch(/signature-map or signer-configuration problem/);
    expect(err.message).toMatch(/VELLAR_X402_POLICIES/);
  });

  it("preserves the raw diagnostics for debugging", () => {
    expect(new SmartAccountAuthError(overCap).message).toContain("policy__");
  });
});
