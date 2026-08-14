// Startup configuration, read from the environment ONCE.
//
// KEY HANDLING (non-negotiable): the payer secret is read here, at startup, from
// an env var or a file. It is NEVER accepted as a tool argument — a tool
// argument is model context, and anything in model context is one prompt
// injection away from being echoed back out. The parsed config keeps the secret
// as a NON-ENUMERABLE property, so `JSON.stringify(config)`, object spreads, and
// `console.log(config)` cannot carry it out by accident.

import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import { ConfigError } from "./errors.js";

export type PayerNetwork = "testnet" | "mainnet";

/** CAIP-2 chain id. The template shape is what @x402/stellar's APIs require. */
export type Caip2 = `${string}:${string}`;

const CAIP2_BY_NETWORK: Record<PayerNetwork, Caip2> = {
  testnet: "stellar:testnet",
  mainnet: "stellar:pubnet",
};

/** 256 KiB of inlined resource text is already a lot for a model context. */
const DEFAULT_MAX_RESPONSE_BYTES = 262_144;

export interface PayerConfig {
  readonly network: PayerNetwork;
  /** CAIP-2 id the 402 challenge must advertise, derived from `network`. */
  readonly caip2: Caip2;
  /** Soroban RPC URL. Undefined ⇒ the official client's default for the network. */
  readonly rpcUrl: string | undefined;
  /**
   * Asset allowlist AND per-asset session ceilings, in one map.
   *
   * These are the same thing on purpose: an asset with no configured ceiling is
   * not payable at all. Base units are only comparable within a single asset, so
   * a single cross-asset total would be meaningless and would fail OPEN on a
   * cheaply-denominated asset. Keyed by SAC contract id.
   */
  readonly ceilings: ReadonlyMap<string, bigint>;
  /** The allowlist as a plain array, for the guard layer. */
  readonly allowedAssets: readonly string[];
  /** Inlined resource text is truncated past this many bytes, with a marker. */
  readonly maxResponseBytes: number;
  /**
   * The paying smart account (`C…`). Present ⇒ LAYER 2: payments are signed for
   * this wallet and its on-chain spending-limit policy is the real bound.
   * Absent ⇒ layer 1 only, paying from the bare keypair as a hot wallet.
   */
  readonly walletAddress?: string;
  /**
   * Policy contracts the signing key's `SignerLimits` require. These must appear
   * in the signature map or the WALLET rejects the entry before the policy is
   * consulted — `Error(Contract, #110)`, which reads as a broken signer rather
   * than a missing co-signer.
   */
  readonly policies: readonly string[];
  /** The payer secret. Non-enumerable — see the module comment. */
  readonly secret: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (v === undefined || v.trim() === "") {
    throw new ConfigError(`${name} is required but was not set.`);
  }
  return v.trim();
}

/**
 * Read the payer secret from `VELLAR_X402_SECRET`, or from the file named by
 * `VELLAR_X402_SECRET_FILE`. The file form keeps the secret out of the process
 * environment, where it would be visible to child processes and to anything that
 * dumps `/proc/<pid>/environ`.
 *
 * Validated with `StrKey` rather than `Keypair.fromSecret`, because the latter
 * throws errors that can quote the input.
 */
function readSecret(env: NodeJS.ProcessEnv): string {
  const file = env.VELLAR_X402_SECRET_FILE?.trim();
  const inline = env.VELLAR_X402_SECRET?.trim();

  if (file && inline) {
    throw new ConfigError(
      "Set exactly one of VELLAR_X402_SECRET or VELLAR_X402_SECRET_FILE, not both.",
    );
  }

  let secret: string;
  if (file) {
    try {
      secret = readFileSync(file, "utf8").trim();
    } catch (err) {
      // Report the PATH, never the contents.
      throw new ConfigError(
        `VELLAR_X402_SECRET_FILE could not be read (${file}): ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }
  } else if (inline) {
    secret = inline;
  } else {
    throw new ConfigError(
      "No payer secret configured. Set VELLAR_X402_SECRET (an S… ed25519 secret) " +
        "or VELLAR_X402_SECRET_FILE (a path to a file containing one). " +
        "The secret is never accepted as a tool argument.",
    );
  }

  if (!StrKey.isValidEd25519SecretSeed(secret)) {
    // Deliberately says nothing about the value itself.
    throw new ConfigError(
      "The configured payer secret is not a valid Stellar ed25519 secret seed (S…).",
    );
  }
  return secret;
}

/**
 * Parse `VELLAR_X402_ASSETS`: `<SAC contract id>:<session ceiling in base units>`,
 * comma-separated. Both halves are mandatory — an asset with no ceiling is
 * rejected rather than defaulted, so the spend limiter fails CLOSED.
 */
function parseAssets(raw: string): Map<string, bigint> {
  const ceilings = new Map<string, bigint>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const parts = trimmed.split(":");
    if (parts.length !== 2) {
      throw new ConfigError(
        `VELLAR_X402_ASSETS entry ${JSON.stringify(trimmed)} is malformed. ` +
          `Expected "<assetContractId>:<sessionCeilingBaseUnits>".`,
      );
    }
    const asset = parts[0]!.trim();
    const ceilingRaw = parts[1]!.trim();

    if (!StrKey.isValidContract(asset)) {
      throw new ConfigError(
        `VELLAR_X402_ASSETS names ${JSON.stringify(asset)}, which is not a Soroban contract id (C…).`,
      );
    }
    if (!/^\d+$/.test(ceilingRaw)) {
      throw new ConfigError(
        `VELLAR_X402_ASSETS ceiling for ${asset} must be a non-negative integer in base units, ` +
          `got ${JSON.stringify(ceilingRaw)}.`,
      );
    }
    const ceiling = BigInt(ceilingRaw);
    if (ceiling === 0n) {
      throw new ConfigError(
        `VELLAR_X402_ASSETS ceiling for ${asset} is 0, which would refuse every payment. ` +
          `Remove the asset instead if it should not be payable.`,
      );
    }
    if (ceilings.has(asset)) {
      throw new ConfigError(`VELLAR_X402_ASSETS lists ${asset} more than once.`);
    }
    ceilings.set(asset, ceiling);
  }

  if (ceilings.size === 0) {
    throw new ConfigError(
      "VELLAR_X402_ASSETS is empty. At least one <assetContractId>:<sessionCeiling> " +
        "pair is required — this server refuses to pay in any asset without a ceiling.",
    );
  }
  return ceilings;
}

/** Parse `VELLAR_X402_POLICIES`: comma-separated policy contract ids. */
function parsePolicies(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return Object.freeze([]);
  const out: string[] = [];
  for (const entry of raw.split(",")) {
    const policy = entry.trim();
    if (policy === "") continue;
    if (!StrKey.isValidContract(policy)) {
      throw new ConfigError(
        `VELLAR_X402_POLICIES names ${JSON.stringify(policy)}, which is not a Soroban contract id (C…).`,
      );
    }
    if (out.includes(policy)) {
      throw new ConfigError(`VELLAR_X402_POLICIES lists ${policy} more than once.`);
    }
    out.push(policy);
  }
  return Object.freeze(out);
}

function parseNetwork(raw: string | undefined): PayerNetwork {
  const value = (raw ?? "testnet").trim();
  if (value !== "testnet" && value !== "mainnet") {
    throw new ConfigError(
      `VELLAR_X402_NETWORK must be "testnet" or "mainnet", got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function parseMaxResponseBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_RESPONSE_BYTES;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigError(
      `VELLAR_X402_MAX_RESPONSE_BYTES must be a positive integer, got ${JSON.stringify(trimmed)}.`,
    );
  }
  const value = Number(trimmed);
  if (value <= 0) {
    throw new ConfigError("VELLAR_X402_MAX_RESPONSE_BYTES must be greater than 0.");
  }
  return value;
}

/**
 * Build the payer configuration from the environment. Throws `ConfigError` with
 * an actionable message — and never with any part of the secret — on bad input.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): PayerConfig {
  const secret = readSecret(env);
  const network = parseNetwork(env.VELLAR_X402_NETWORK);
  const ceilings = parseAssets(required(env, "VELLAR_X402_ASSETS"));
  const rpcUrl = env.VELLAR_X402_RPC_URL?.trim() || undefined;
  const maxResponseBytes = parseMaxResponseBytes(env.VELLAR_X402_MAX_RESPONSE_BYTES);

  const walletAddress = env.VELLAR_X402_WALLET?.trim() || undefined;
  if (walletAddress !== undefined && !StrKey.isValidContract(walletAddress)) {
    throw new ConfigError(
      `VELLAR_X402_WALLET must be a Soroban contract id (C…), got ${JSON.stringify(walletAddress)}.`,
    );
  }

  const policies = parsePolicies(env.VELLAR_X402_POLICIES);
  if (policies.length > 0 && walletAddress === undefined) {
    // Policies only mean something for a smart account. Silently ignoring them
    // would look like layer 2 is configured when it is not.
    throw new ConfigError(
      "VELLAR_X402_POLICIES is set but VELLAR_X402_WALLET is not. Policies apply to a " +
        "smart account's signer; without a wallet there is no on-chain budget to enforce.",
    );
  }

  const config = {
    network,
    caip2: CAIP2_BY_NETWORK[network],
    rpcUrl,
    ceilings,
    allowedAssets: Object.freeze([...ceilings.keys()]),
    maxResponseBytes,
    ...(walletAddress !== undefined ? { walletAddress } : {}),
    policies,
  };

  // Non-enumerable: absent from JSON.stringify, {...spread}, Object.keys, and
  // Node's console formatting of the object. TypeScript cannot express "present
  // but non-enumerable", so the cast is the price of the property that matters.
  Object.defineProperty(config, "secret", {
    value: secret,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(config) as unknown as PayerConfig;
}
