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
 * a guessed one fails silently). Prefer mainnetConfig() over using this directly.
 *
 * To obtain walletWasmHash, follow the exact passkey-kit manifest verification
 * steps in website/content/docs/getting-started/mainnet-wasm-hash.md. */
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

/**
 * Machine-readable reason a mainnet config could not be built (#863).
 * These values are stable API surface — callers branch on `error.code`, never
 * on the human-readable message.
 */
export type MainnetConfigErrorCode =
  | "missing-rpcUrl"
  | "malformed-rpcUrl"
  | "missing-walletWasmHash"
  | "malformed-walletWasmHash";

export class MainnetConfigError extends Error {
  /** The specific validation failure, when thrown by `mainnetConfig()`. */
  readonly code: MainnetConfigErrorCode | undefined;

  constructor(message: string, code?: MainnetConfigErrorCode) {
    super(message);
    this.name = "MainnetConfigError";
    this.code = code;
  }
}

/**
 * Input accepted by {@link warnIfMainnetSpread}. Supplied loosely so callers can
 * pass a whole wallet config, a `NetworkConfig`, or a partial object without
 * casting.
 */
export interface MainnetSpreadCheckInput {
  network?: unknown;
  rpcUrl?: unknown;
  walletWasmHash?: unknown;
}

/**
 * Safety net for the common mistake of spreading the bare `MAINNET` constant
 * into an entry point and leaving its two intentionally blank fields in place
 * (#861). Blank-but-valid-looking config values otherwise fail much later, so
 * this warns at the boundary and points at `mainnetConfig()`.
 *
 * Returns true when a warning was emitted, so callers and tests can assert the
 * detection without scraping console output.
 */
export function warnIfMainnetSpread(
  config: MainnetSpreadCheckInput,
  entryPoint = "createVellarWallet",
): boolean {
  if (config?.network !== "mainnet") return false;

  const blank = (value: unknown, shipped: string): boolean =>
    value == null || (typeof value === "string" && value.trim() === shipped);
  const blankRpcUrl = blank(config.rpcUrl, MAINNET.rpcUrl);
  const blankHash = blank(config.walletWasmHash, MAINNET.walletWasmHash);
  if (!blankRpcUrl && !blankHash) return false;

  const fields = [blankRpcUrl && "rpcUrl", blankHash && "walletWasmHash"]
    .filter((field): field is string => Boolean(field))
    .join(" and ");
  console.warn(
    `${entryPoint}: received a mainnet config with blank ${fields} — this looks like ` +
      "MAINNET was spread directly. Use mainnetConfig({ rpcUrl, walletWasmHash }) instead; " +
      "blank mainnet fields fail at runtime.",
  );
  return true;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
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
      "missing-rpcUrl",
    );
  }
  if (!isHttpUrl(rpcUrl)) {
    throw new MainnetConfigError(
      `mainnetConfig: rpcUrl must be a valid http(s) URL (got ${JSON.stringify(rpcUrl)}).`,
      "malformed-rpcUrl",
    );
  }
  if (!walletWasmHash) {
    throw new MainnetConfigError(
      "mainnetConfig: walletWasmHash is required — verify it against the passkey-kit mainnet deployment manifest for your version.",
      "missing-walletWasmHash",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(walletWasmHash)) {
    throw new MainnetConfigError(
      "mainnetConfig: walletWasmHash must be a 64-char hex hash verified against the passkey-kit mainnet deployment manifest for your version.",
      "malformed-walletWasmHash",
    );
  }
  return { ...MAINNET, rpcUrl, walletWasmHash: walletWasmHash.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Operator configuration helpers.
//
// These mirror the documented self-hosted facilitator configuration
// (website/content/docs/operators/limits.md and
// website/content/docs/reference/fees.md) so a consumer standing up their own
// facilitator for local integration testing can validate their environment
// before running anything. They are setup / monitoring aids only — the
// facilitator remains the source of truth for enforcement.
// ---------------------------------------------------------------------------

/** Number of channel account secret keys a self-hosted facilitator requires. */
export const CHANNEL_ACCOUNT_SECRET_KEY_COUNT = 50;

/** Documented default soft floor (alert threshold) for the sponsor balance. */
export const DEFAULT_SPONSOR_SOFT_FLOOR_STROOPS = 250_000_000n;

/** Documented default hard floor (refusal threshold) for the sponsor balance. */
export const DEFAULT_SPONSOR_HARD_FLOOR_STROOPS = 100_000_000n;

/** Documented default global rolling spend ceiling. */
export const DEFAULT_SPEND_CEILING_STROOPS = 50_000_000n;

/** Documented default global rolling spend window length. */
export const DEFAULT_SPEND_WINDOW_MS = 60_000;

/** Typed error thrown by the operator configuration helpers. */
export class OperatorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorConfigError";
  }
}

// Stellar classic secret keys ("S…") are 56 chars of base32 (RFC 4648 upper
// case alphabet), the first of which is the version byte 'S'.
const STELLAR_SECRET_KEY_RE = /^S[A-Z2-7]{55}$/;

/** True if `value` is a well-formed Stellar classic secret key (S…, 56 chars,
 * base32 alphabet). Shape check only — it does not verify the checksum. */
export function isWellFormedStellarSecretKey(value: string): boolean {
  return typeof value === "string" && STELLAR_SECRET_KEY_RE.test(value);
}

export interface ValidateChannelAccountSecretKeysOptions {
  /** The sponsor secret key. If present anywhere in the channel account set,
   * validation fails — the sponsor key must never be a channel account key. */
  sponsorSecretKey?: string;
}

/**
 * Validate a candidate CHANNEL_ACCOUNT_SECRET_KEYS value for a self-hosted
 * facilitator. The value must be exactly 50 comma-separated Stellar classic
 * secret keys. If `opts.sponsorSecretKey` is supplied, it must not appear
 * anywhere in the set (the sponsor key is not a channel account key).
 *
 * Returns the trimmed, validated keys. Throws {@link OperatorConfigError} on
 * any problem, with a message naming the offending entry.
 */
export function validateChannelAccountSecretKeys(
  value: string,
  opts: ValidateChannelAccountSecretKeysOptions = {},
): string[] {
  if (typeof value !== "string") {
    throw new OperatorConfigError(
      "CHANNEL_ACCOUNT_SECRET_KEYS must be a comma-separated string of Stellar secret keys.",
    );
  }
  const keys = value.split(",").map((k) => k.trim());
  if (keys.length !== CHANNEL_ACCOUNT_SECRET_KEY_COUNT) {
    throw new OperatorConfigError(
      `CHANNEL_ACCOUNT_SECRET_KEYS must contain exactly ${CHANNEL_ACCOUNT_SECRET_KEY_COUNT} comma-separated keys; got ${keys.length}.`,
    );
  }
  const sponsor = opts.sponsorSecretKey?.trim();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!isWellFormedStellarSecretKey(key)) {
      throw new OperatorConfigError(
        `CHANNEL_ACCOUNT_SECRET_KEYS entry ${i + 1} is not a well-formed Stellar classic secret key (expected S…, 56 chars).`,
      );
    }
    if (sponsor && key === sponsor) {
      throw new OperatorConfigError(
        `CHANNEL_ACCOUNT_SECRET_KEYS entry ${i + 1} is the sponsor secret key; the sponsor key must not be among the channel account keys.`,
      );
    }
  }
  return keys;
}

export type SponsorBalanceStatus = "healthy" | "soft-floor-warning" | "hard-floor-refused";

export interface ClassifySponsorBalanceOptions {
  /** Soft floor (alert threshold). Defaults to 250,000,000 stroops. */
  softFloorStroops?: bigint;
  /** Hard floor (refusal threshold). Defaults to 100,000,000 stroops. */
  hardFloorStroops?: bigint;
}

export interface SponsorBalanceClassification {
  status: SponsorBalanceStatus;
  balanceStroops: bigint;
  softFloorStroops: bigint;
  hardFloorStroops: bigint;
}

/**
 * Classify a current sponsor balance against the documented soft and hard
 * floors. Returns 'healthy' above the soft floor, 'soft-floor-warning' between
 * the two floors, and 'hard-floor-refused' at or below the hard floor. Throws
 * {@link OperatorConfigError} if the floors are not ordered hard < soft.
 */
export function classifySponsorBalance(
  balanceStroops: bigint,
  opts: ClassifySponsorBalanceOptions = {},
): SponsorBalanceClassification {
  const softFloorStroops = opts.softFloorStroops ?? DEFAULT_SPONSOR_SOFT_FLOOR_STROOPS;
  const hardFloorStroops = opts.hardFloorStroops ?? DEFAULT_SPONSOR_HARD_FLOOR_STROOPS;
  if (hardFloorStroops >= softFloorStroops) {
    throw new OperatorConfigError(
      `SPONSOR_HARD_FLOOR_STROOPS (${hardFloorStroops}) must be less than SPONSOR_SOFT_FLOOR_STROOPS (${softFloorStroops}).`,
    );
  }
  let status: SponsorBalanceStatus;
  if (balanceStroops <= hardFloorStroops) {
    status = "hard-floor-refused";
  } else if (balanceStroops <= softFloorStroops) {
    status = "soft-floor-warning";
  } else {
    status = "healthy";
  }
  return { status, balanceStroops, softFloorStroops, hardFloorStroops };
}

export interface RollingSpendWindowOptions {
  /** Rolling spend ceiling. Defaults to 50,000,000 stroops. */
  ceilingStroops?: bigint;
  /** Rolling window length in milliseconds. Defaults to 60,000 ms. */
  windowMs?: number;
  /** Injectable clock (returns epoch milliseconds). Defaults to Date.now. */
  now?: () => number;
}

export interface SpendCheckResult {
  /** True if the spend fits within the remaining ceiling. */
  allowed: boolean;
  /** Spend accumulated in the current window, including the candidate. */
  spentStroops: bigint;
  /** Remaining ceiling in the current window after the candidate spend. */
  remainingStroops: bigint;
}

/**
 * Local rolling-window spend accounting mirroring the facilitator's
 * SPEND_CEILING_STROOPS / SPEND_WINDOW_MS semantics. This is a local estimation
 * aid only — it is NOT a substitute for the facilitator's server-side
 * enforcement. The window rolls forward (resetting accumulated spend) once
 * `windowMs` has elapsed since the window started.
 */
export class RollingSpendWindow {
  readonly ceilingStroops: bigint;
  readonly windowMs: number;
  private readonly now: () => number;
  private windowStartMs: number;
  private spentStroops = 0n;

  constructor(opts: RollingSpendWindowOptions = {}) {
    const ceilingStroops = opts.ceilingStroops ?? DEFAULT_SPEND_CEILING_STROOPS;
    const windowMs = opts.windowMs ?? DEFAULT_SPEND_WINDOW_MS;
    if (ceilingStroops <= 0n) {
      throw new OperatorConfigError("SPEND_CEILING_STROOPS must be greater than zero.");
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new OperatorConfigError("SPEND_WINDOW_MS must be a positive number of milliseconds.");
    }
    this.ceilingStroops = ceilingStroops;
    this.windowMs = windowMs;
    this.now = opts.now ?? Date.now;
    this.windowStartMs = this.now();
  }

  /** Roll the window forward if it has elapsed, resetting accumulated spend. */
  private roll(): void {
    const t = this.now();
    if (t - this.windowStartMs >= this.windowMs) {
      this.windowStartMs = t;
      this.spentStroops = 0n;
    }
  }

  /** Spend accumulated in the current window. */
  get spent(): bigint {
    this.roll();
    return this.spentStroops;
  }

  /** Remaining ceiling in the current window. */
  get remaining(): bigint {
    this.roll();
    const remaining = this.ceilingStroops - this.spentStroops;
    return remaining > 0n ? remaining : 0n;
  }

  /** Check whether `amountStroops` fits within the current window's remaining
   * ceiling, without recording it. */
  checkSpend(amountStroops: bigint): SpendCheckResult {
    if (amountStroops < 0n) {
      throw new OperatorConfigError("Spend amount must not be negative.");
    }
    this.roll();
    const spentStroops = this.spentStroops + amountStroops;
    const remaining = this.ceilingStroops - spentStroops;
    return {
      allowed: remaining >= 0n,
      spentStroops,
      remainingStroops: remaining > 0n ? remaining : 0n,
    };
  }

  /** Record `amountStroops` against the current window. Returns the same shape
   * as {@link checkSpend}; when not allowed, nothing is recorded. */
  recordSpend(amountStroops: bigint): SpendCheckResult {
    const result = this.checkSpend(amountStroops);
    if (result.allowed) {
      this.spentStroops += amountStroops;
    }
    return result;
  }
}
