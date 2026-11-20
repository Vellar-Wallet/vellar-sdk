import { describe, expect, it } from "vitest";
import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import {
  MAINNET,
  MainnetConfigError,
  RollingSpendWindow,
  TESTNET,
  classifySponsorBalance,
  mainnetConfig,
  validateChannelAccountSecretKeys,
} from "./config";

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

/** Builds `count` distinct, well-formed Stellar classic secret keys. */
function makeSecretKeys(count: number): string[] {
  return Array.from({ length: count }, () => Keypair.random().secret());
}

describe("validateChannelAccountSecretKeys()", () => {
  it("accepts exactly 50 well-formed classic secret keys", () => {
    const keys = makeSecretKeys(50);
    expect(() => validateChannelAccountSecretKeys(keys.join(","))).not.toThrow();
  });

  it("accepts a 50-key list when a sponsor key is supplied but not duplicated", () => {
    const keys = makeSecretKeys(50);
    const sponsor = Keypair.random().secret();
    expect(() => validateChannelAccountSecretKeys(keys.join(","), sponsor)).not.toThrow();
  });

  it("throws when there are too few keys", () => {
    const keys = makeSecretKeys(49);
    expect(() => validateChannelAccountSecretKeys(keys.join(","))).toThrow(/50/);
  });

  it("throws when there are too many keys", () => {
    const keys = makeSecretKeys(51);
    expect(() => validateChannelAccountSecretKeys(keys.join(","))).toThrow(/50/);
  });

  it("throws when a key among a valid 50 is malformed", () => {
    const keys = makeSecretKeys(50);
    keys[17] = "not-a-secret-key";
    expect(() => validateChannelAccountSecretKeys(keys.join(","))).toThrow(/not-a-secret-key/);
  });

  it("throws when the sponsor key is duplicated into the channel account set", () => {
    const keys = makeSecretKeys(50);
    const sponsor = Keypair.random().secret();
    keys[42] = sponsor;
    expect(() => validateChannelAccountSecretKeys(keys.join(","), sponsor)).toThrow(/sponsor/i);
  });
});

describe("classifySponsorBalance()", () => {
  it("classifies a balance above the soft floor as healthy", () => {
    expect(classifySponsorBalance(300_000_000)).toBe("healthy");
  });

  it("classifies a balance between the two floors as a soft-floor warning", () => {
    expect(classifySponsorBalance(150_000_000)).toBe("soft-floor-warning");
  });

  it("classifies a balance below the hard floor as refused", () => {
    expect(classifySponsorBalance(50_000_000)).toBe("hard-floor-refused");
  });

  it("honours caller-supplied floor overrides", () => {
    expect(classifySponsorBalance(300_000_000, { softFloorStroops: 400_000_000 })).toBe(
      "soft-floor-warning",
    );
    expect(classifySponsorBalance(150_000_000, { hardFloorStroops: 200_000_000 })).toBe(
      "hard-floor-refused",
    );
  });
});

describe("RollingSpendWindow", () => {
  it("accumulates spend and rejects amounts over the ceiling", () => {
    let now = 0;
    const window = new RollingSpendWindow({ now: () => now });
    expect(window.record(20_000_000)).toBe(true);
    expect(window.record(20_000_000)).toBe(true);
    expect(window.remaining()).toBe(10_000_000);
    expect(window.record(20_000_000)).toBe(false);
    expect(window.spent()).toBe(40_000_000);
  });

  it("rolls the window forward and resets accumulated spend after the window elapses", () => {
    let now = 0;
    const window = new RollingSpendWindow({ now: () => now });
    expect(window.record(50_000_000)).toBe(true);
    expect(window.remaining()).toBe(0);

    now = 59_999;
    expect(window.spent()).toBe(50_000_000);

    now = 60_000;
    expect(window.spent()).toBe(0);
    expect(window.remaining()).toBe(50_000_000);
    expect(window.record(50_000_000)).toBe(true);
  });

  it("honours caller-supplied ceiling and window overrides", () => {
    let now = 0;
    const window = new RollingSpendWindow({
      ceilingStroops: 1_000,
      windowMs: 100,
      now: () => now,
    });
    expect(window.record(1_000)).toBe(true);
    expect(window.record(1)).toBe(false);
    now = 100;
    expect(window.record(1_000)).toBe(true);
  });
});
