// Network configuration constants a consumer needs to construct PasskeyKit and
// SACClient. These are easy to get wrong or not know at all, so the SDK ships
// them. The wasm hash is the canonical passkey-kit smart-wallet contract — it
// MUST match the passkey-kit version (see the passkey-kit deployment manifest);
// re-check it on every passkey-kit upgrade.

export interface NetworkConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  /** Canonical smart-wallet wasm hash for this network + passkey-kit version. */
  walletWasmHash: string;
  /** Native asset (XLM) SAC contract id on this network. */
  nativeTokenContractId: string;
  /** Circle's USDC issuer (G…) on this network. Pin it to tell real Circle
   * USDC from an impostor asset that also calls itself "USDC". */
  usdcIssuer: string;
  /** USDC SAC contract id on this network, derived from {@link usdcIssuer}. */
  usdcContractId: string;
}

export const TESTNET: NetworkConfig = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  walletWasmHash: "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0",
  nativeTokenContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  // Derived from Circle's official USDC issuer for this network. Verify against:
  // https://www.circle.com/multi-chain-usdc/stellar
  // A wrong contractId fails loudly (simulation error). A wrong issuer silently
  // accepts impostor assets.
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  usdcContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

// ---------------------------------------------------------------------------
// Mainnet.
//
// STATUS: mainnet use of this SDK is pending a security review. Shipping this
// config does NOT make mainnet blessed — it removes the "I cannot even target
// mainnet" wall for the values that ARE knowable, and forces the two that are
// not to be supplied explicitly rather than guessed.
//
// Five fields are published by SDF / Circle / derivable and are filled below:
//   - networkPassphrase      (the canonical mainnet passphrase)
//   - horizonUrl             (SDF's public mainnet Horizon)
//   - nativeTokenContractId  (the XLM SAC id — deterministic, derived from the
//     asset + mainnet passphrase; config.test verifies the derivation)
//   - usdcIssuer             (Circle's published mainnet USDC issuer)
//   - usdcContractId         (the USDC SAC id — deterministic, derived from the
//     issuer + mainnet passphrase; config.test verifies the derivation)
//
// Two fields are DEPLOYMENT / PROVIDER-specific and are intentionally left
// blank, because a wrong value fails SILENTLY (a bad wasm hash breaks wallet
// creation with no obvious cause) whereas a blank value fails LOUDLY:
//   - rpcUrl: there is no free public SDF mainnet Soroban RPC (SDF runs a public
//     RPC for testnet only). Supply a provider endpoint.
//   - walletWasmHash: passkey-kit does not publish a mainnet smart-wallet wasm
//     hash for the version this SDK targets. Verify the correct hash against the
//     passkey-kit mainnet deployment manifest for YOUR passkey-kit version and
//     supply it. Do not copy the testnet hash on faith.
//
// Use mainnetConfig({ rpcUrl, walletWasmHash }) to get a complete, ready-to-use
// NetworkConfig with the verified fields filled and the two required values
// supplied by you. Prefer it over spreading MAINNET directly.
// ---------------------------------------------------------------------------

/** Mainnet config with the SDF-published / derivable fields filled. rpcUrl and
 * walletWasmHash are blank on purpose — supply them (a blank value fails loudly,
 * a guessed one fails silently). Prefer mainnetConfig() over using this directly. */
export const MAINNET: NetworkConfig = {
  network: "mainnet",
  rpcUrl: "",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  horizonUrl: "https://horizon.stellar.org",
  walletWasmHash: "",
  nativeTokenContractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  // Derived from Circle's official USDC issuer for this network. Verify against:
  // https://www.circle.com/multi-chain-usdc/stellar
  // A wrong contractId fails loudly (simulation error). A wrong issuer silently
  // accepts impostor assets.
  usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  usdcContractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
};

// ---------------------------------------------------------------------------
// Mirrored facilitator operator defaults.
//
// SINGLE SOURCE OF TRUTH for the numeric defaults documented for the
// facilitator operator env vars. Estimation helpers (sponsor floors, spend
// ceiling/window, fee ceiling, settlement limits, channel-account minimums)
// import from here instead of hardcoding their own copies, so a docs change is
// a one-line edit in this module.
//
// These values mirror the documented defaults in:
//   - website/content/docs/operators/configuration.md
//   - website/content/docs/reference/fees.md
//
// UPDATE THIS MODULE whenever those docs values change. config.test.ts asserts
// every constant below matches the documented default exactly.
// ---------------------------------------------------------------------------

/** Max transaction fee (stroops) the facilitator will pay. */
// Source: website/content/docs/reference/fees.md (MAX_TX_FEE_STROOPS default).
export const MAX_TX_FEE_STROOPS = 500_000;

/** Soft sponsor-balance floor (stroops): below this, estimation warns. */
// Source: website/content/docs/operators/configuration.md (SPONSOR_SOFT_FLOOR_STROOPS default).
export const SPONSOR_SOFT_FLOOR_STROOPS = 250_000_000;

/** Hard sponsor-balance floor (stroops): below this, estimation refuses. */
// Source: website/content/docs/operators/configuration.md (SPONSOR_HARD_FLOOR_STROOPS default).
export const SPONSOR_HARD_FLOOR_STROOPS = 100_000_000;

/** Per-window spend ceiling (stroops) for a sponsor account. */
// Source: website/content/docs/operators/configuration.md (SPEND_CEILING_STROOPS default).
export const SPEND_CEILING_STROOPS = 50_000_000;

/** Length of the rolling spend window, in milliseconds. */
// Source: website/content/docs/operators/configuration.md (SPEND_WINDOW_MS default).
export const SPEND_WINDOW_MS = 60_000;

/** Length of the settlement rate-limit window, in milliseconds. */
// Source: website/content/docs/operators/configuration.md (SETTLE_RATE_WINDOW_MS default).
export const SETTLE_RATE_WINDOW_MS = 60_000;

/** Max settlements per URL within the rate window. */
// Source: website/content/docs/operators/configuration.md (SETTLE_PER_URL_MAX default).
export const SETTLE_PER_URL_MAX = 10;

/** Max settlements per pay-to address within the rate window. */
// Source: website/content/docs/operators/configuration.md (SETTLE_PER_PAYTO_MAX default).
export const SETTLE_PER_PAYTO_MAX = 50;

/** Max settlements from the unbound pool within the rate window. */
// Source: website/content/docs/operators/configuration.md (SETTLE_UNBOUND_POOL_MAX default).
export const SETTLE_UNBOUND_POOL_MAX = 10;

/** Minimum balance (stroops) a channel account must hold. */
// Source: website/content/docs/operators/configuration.md (CHANNEL_ACCOUNT_MIN_STROOPS default).
export const CHANNEL_ACCOUNT_MIN_STROOPS = 5_000_000;

/** How often (ms) the sponsor-balance monitor polls. */
// Source: website/content/docs/operators/configuration.md (SPONSOR_BALANCE_INTERVAL_MS default).
export const SPONSOR_BALANCE_INTERVAL_MS = 60_000;

export class MainnetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainnetConfigError";
  }
}

/**
 * Build a complete mainnet NetworkConfig. You supply the two values the SDK
 * cannot verify for you — your Soroban RPC provider URL and the passkey-kit
 * mainnet smart-wallet wasm hash (verified against the deployment manifest for
 * your passkey-kit version). The verified fields (passphrase, Horizon, native
 * XLM SAC id, USDC issuer and SAC id) are filled in. Throws if either required value is missing or
 * malformed, so a broken mainnet config can never be constructed silently.
 *
 * Explicit non-fallback guarantee (#859): this function NEVER substitutes
 * `TESTNET.walletWasmHash` (or any other default) for a missing or malformed
 * value. A blank hash always throws. A mainnet wallet silently using the
 * testnet contract would be exactly the failure mode this API exists to
 * prevent.
 */
export function mainnetConfig(opts: { rpcUrl: string; walletWasmHash: string }): NetworkConfig {
  const rpcUrl = opts.rpcUrl?.trim();
  const walletWasmHash = opts.walletWasmHash?.trim();
  if (!rpcUrl) {
    throw new MainnetConfigError(
      "mainnetConfig: rpcUrl is required — there is no public SDF mainnet Soroban RPC, supply a provider endpoint.",
    );
  }
  if (!walletWasmHash || !/^[0-9a-fA-F]{64}$/.test(walletWasmHash)) {
    throw new MainnetConfigError(
      "mainnetConfig: walletWasmHash must be a 64-char hex hash verified against the passkey-kit mainnet deployment manifest for your version.",
    );
  }
  return { ...MAINNET, rpcUrl, walletWasmHash: walletWasmHash.toLowerCase() };
}
