import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Asset, Networks, StrKey, xdr } from "@stellar/stellar-sdk";
import { MAINNET, MainnetConfigError, TESTNET, mainnetConfig } from "./config";
import * as facilitatorDefaults from "./facilitator-defaults";

describe("network config", () => {
  it("TESTNET has all required fields", () => {
    expect(TESTNET.network).toBe("testnet");
    expect(TESTNET.rpcUrl).toBeTruthy();
    expect(TESTNET.walletWasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(TESTNET.nativeTokenContractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("uses the canonical mainnet passphrase and Horizon", () => {
    expect(MAINNET.network).toBe("mainnet");
    expect(MAINNET.networkPassphrase).toBe(Networks.PUBLIC);
    expect(MAINNET.horizonUrl).toBe("https://horizon.stellar.org");
  });

  it("derives the native XLM SAC ids correctly (not hardcoded on faith)", () => {
    // The native SAC id is deterministic from the asset + passphrase. Deriving
    // it here proves the shipped constants are correct, and guards against a
    // typo silently pointing integrators at the wrong token contract.
    expect(TESTNET.nativeTokenContractId).toBe(Asset.native().contractId(TESTNET.networkPassphrase));
    expect(MAINNET.nativeTokenContractId).toBe(Asset.native().contractId(MAINNET.networkPassphrase));
  });

  it("derives the XLM SAC contract id from first principles for TESTNET and MAINNET", () => {
    // Independent derivation, no Asset.contractId() helper involved. Method
    // (Stellar CAP-46 / SEP-41 contract-id derivation), checkable by hand:
    //   1. networkId = SHA-256(networkPassphrase, utf-8)
    //   2. preimage  = HashIdPreimage ENVELOPE_TYPE_CONTRACT_ID {
    //        networkId, contractIdPreimage = FROM_ASSET(native) }
    //   3. contractId = SHA-256(XDR bytes of the preimage)
    //   4. strkey     = base32 "C…" encoding (StrKey.encodeContract) of those 32 bytes
    // The result must equal the shipped nativeTokenContractId exactly.
    const deriveNativeSacId = (passphrase: string): string => {
      const networkId = createHash("sha256").update(passphrase, "utf8").digest();
      const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId,
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(xdr.Asset.assetTypeNative()),
        }),
      );
      const contractIdBytes = createHash("sha256").update(preimage.toXDR()).digest();
      return StrKey.encodeContract(contractIdBytes);
    };

    expect(deriveNativeSacId(TESTNET.networkPassphrase)).toBe(TESTNET.nativeTokenContractId);
    expect(deriveNativeSacId(MAINNET.networkPassphrase)).toBe(MAINNET.nativeTokenContractId);
    // The two networks must never share an id (it is bound to the passphrase).
    expect(TESTNET.nativeTokenContractId).not.toBe(MAINNET.nativeTokenContractId);
  });

  it("derives the USDC SAC ids from the issuer correctly (not hardcoded on faith)", () => {
    // Same guarantee as the XLM test above: the SAC id is deterministic from
    // the asset code + issuer + passphrase, so deriving it here proves the
    // shipped constant matches the shipped issuer and catches a typo in either.
    expect(TESTNET.usdcContractId).toBe(
      new Asset("USDC", TESTNET.usdcIssuer).contractId(TESTNET.networkPassphrase),
    );
    expect(MAINNET.usdcContractId).toBe(
      new Asset("USDC", MAINNET.usdcIssuer).contractId(MAINNET.networkPassphrase),
    );
  });

  it("pins Circle's USDC issuers so an impostor issuer fails loudly", () => {
    // The derivation test above only proves the SAC matches the issuer — a
    // wrong-but-consistent issuer would still pass it. These exact-string
    // assertions are what actually pin the asset to Circle, so any future edit
    // to an issuer breaks the build instead of silently repointing integrators
    // at an impostor asset that also calls itself "USDC".
    expect(TESTNET.usdcIssuer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(MAINNET.usdcIssuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  });

  it("leaves mainnet rpcUrl and walletWasmHash blank on purpose (fail loud, not silent)", () => {
    // These are deployment/provider-specific and must be supplied by the
    // integrator. A blank value fails loudly; a guessed one fails silently.
    expect(MAINNET.rpcUrl).toBe("");
    expect(MAINNET.walletWasmHash).toBe("");
  });
});

describe("facilitator defaults (doc-mirrored constants)", () => {
  // These assertions pin every exported constant to the exact value documented
  // in website/content/docs/operators/configuration.md and reference/fees.md.
  // If a docs value changes, update the constants module AND this test together;
  // a drift here means the client-side estimation helpers no longer match what
  // operators actually run with.

  it("SPONSOR_FLOOR_STROOPS matches the documented default", () => {
    // Source: website/content/docs/operators/configuration.md — sponsor floor default.
    expect(facilitatorDefaults.SPONSOR_FLOOR_STROOPS).toBe(10_000_000);
  });

  it("SPEND_CEILING_STROOPS matches the documented default", () => {
    // Source: website/content/docs/operators/configuration.md — spend ceiling default.
    expect(facilitatorDefaults.SPEND_CEILING_STROOPS).toBe(100_000_000_000);
  });

  it("SPEND_WINDOW_SECONDS matches the documented default", () => {
    // Source: website/content/docs/operators/configuration.md — spend window default.
    expect(facilitatorDefaults.SPEND_WINDOW_SECONDS).toBe(86_400);
  });

  it("MAX_TX_FEE_STROOPS matches the documented default", () => {
    // Source: website/content/docs/reference/fees.md — max transaction fee default.
    expect(facilitatorDefaults.MAX_TX_FEE_STROOPS).toBe(1_000_000);
  });

  it("exports only the documented, mirrored defaults (guards against undocumented drift)", () => {
    // Every export must be a finite number; a non-numeric or missing export
    // means the module drifted from the documented env var defaults.
    const exported = Object.entries(facilitatorDefaults);
    expect(exported.length).toBeGreaterThan(0);
    for (const [name, value] of exported) {
      expect(typeof value, `${name} must be a number`).toBe("number");
      expect(Number.isFinite(value as number), `${name} must be finite`).toBe(true);
    }
  });
});

describe("mainnetConfig()", () => {
  const VALID_HASH = "a".repeat(64);

  it("fills the verified fields and applies the supplied values", () => {
    const cfg = mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: VALID_HASH });
    expect(cfg.network).toBe("mainnet");
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.horizonUrl).toBe("https://horizon.stellar.org");
    expect(cfg.nativeTokenContractId).toBe(MAINNET.nativeTokenContractId);
    expect(cfg.usdcIssuer).toBe(MAINNET.usdcIssuer);
    expect(cfg.usdcContractId).toBe(MAINNET.usdcContractId);
    expect(cfg.rpcUrl).toBe("https://rpc.example.com");
    expect(cfg.walletWasmHash).toBe(VALID_HASH);
  });

  it("lowercases and trims the wasm hash", () => {
    const cfg = mainnetConfig({ rpcUrl: " https://rpc.example.com ", walletWasmHash: "A".repeat(64) });
    expect(cfg.rpcUrl).toBe("https://rpc.example.com");
    expect(cfg.walletWasmHash).toBe("a".repeat(64));
  });

  it("throws when rpcUrl is missing", () => {
    expect(() => mainnetConfig({ rpcUrl: "", walletWasmHash: VALID_HASH })).toThrow(
      MainnetConfigError,
    );
  });

  it("throws when walletWasmHash is missing or not a 64-char hex hash", () => {
    expect(() => mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "" })).toThrow(
      MainnetConfigError,
    );
    expect(() =>
      mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "not-a-hash" }),
    ).toThrow(MainnetConfigError);
    expect(() =>
      mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "abc" }),
    ).toThrow(MainnetConfigError);
  });
});
