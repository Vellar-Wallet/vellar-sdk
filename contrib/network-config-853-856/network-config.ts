// Reference implementation for #853, #854, #855, and #856.
//
// Contributor PRs may only touch contrib/. These helpers import the real
// TESTNET, MAINNET, and mainnetConfig values and are covered by the default
// vitest run. Merging them into src/config.ts is the integration step in
// README.md. Until a maintainer does that, import them from this module.

import { createHash } from "node:crypto";
import { StrKey, xdr } from "@stellar/stellar-sdk";
import { MAINNET, TESTNET, mainnetConfig, type NetworkConfig } from "../../src/config";

export class NetworkConfigMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkConfigMigrationError";
  }
}

export class NativeTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeTokenConfigError";
  }
}

/** A NetworkConfig from before 0.6.2, when the two USDC fields were not required. */
export type Pre062NetworkConfig = Omit<NetworkConfig, "usdcIssuer" | "usdcContractId"> & {
  usdcIssuer?: string;
  usdcContractId?: string;
};

/**
 * Fill `usdcIssuer` and `usdcContractId` from the shipped constants for the
 * same network. Throws when `network` is neither testnet nor mainnet, because
 * those fill-in values are network-specific (#856).
 */
export function migrateNetworkConfig(config: Pre062NetworkConfig): NetworkConfig {
  if (config.network !== "testnet" && config.network !== "mainnet") {
    throw new NetworkConfigMigrationError(
      `migrateNetworkConfig: network "${String(config.network)}" does not match testnet or mainnet. ` +
        "usdcIssuer and usdcContractId are network-specific and cannot be filled in.",
    );
  }
  const verified = config.network === "testnet" ? TESTNET : MAINNET;
  return {
    ...config,
    network: config.network,
    usdcIssuer: verified.usdcIssuer,
    usdcContractId: verified.usdcContractId,
  };
}

/**
 * SAC contract id for the native asset, derived from the passphrase alone.
 * Same steps as the derivation test in src/config.test.ts (CAP-46 / SEP-41):
 * network id, HashIdPreimage ENVELOPE_TYPE_CONTRACT_ID with a native asset
 * preimage, SHA-256, strkey.
 */
export function deriveNativeSacContractId(networkPassphrase: string): string {
  const networkId = createHash("sha256").update(networkPassphrase, "utf8").digest();
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(xdr.Asset.assetTypeNative()),
    }),
  );
  const contractIdBytes = createHash("sha256").update(preimage.toXDR()).digest();
  return StrKey.encodeContract(contractIdBytes);
}

/**
 * Config-consistency guard (#854). Re-derives the native XLM SAC id from
 * `networkPassphrase` and compares it to `nativeTokenContractId`. Use it in
 * CI when `src/config.ts` changes so one field cannot move without the other.
 * The derivation tests in src/config.test.ts check the same property on the
 * shipped constants; this helper is what a caller runs against any config,
 * including a `mainnetConfig()` result.
 */
export function assertNativeTokenMatchesPassphrase(
  config: Pick<NetworkConfig, "networkPassphrase" | "nativeTokenContractId">,
): void {
  const derived = deriveNativeSacContractId(config.networkPassphrase);
  if (derived !== config.nativeTokenContractId) {
    throw new NativeTokenConfigError(
      `nativeTokenContractId ${config.nativeTokenContractId} does not match the SAC id derived from networkPassphrase (expected ${derived}). ` +
        "This is a config-consistency guard: update both fields together. See src/config.test.ts.",
    );
  }
}

export const SHIPPED_CONFIGS = { TESTNET, MAINNET, mainnetConfig };
