import { StrKey } from "@stellar/stellar-sdk";

export interface InvalidAllowedAsset {
  asset: string;
  reason: string;
}

/**
 * Reports every invalid allowed-assets entry so callers can fix a complete
 * configuration in one pass. An empty list means the x402 client is not
 * restricted to a configured asset allow-list.
 */
export function validateAllowedAssets(allowedAssets: readonly string[]): InvalidAllowedAsset[] {
  return allowedAssets.flatMap((asset) => {
    if (!asset.startsWith("C")) {
      return [{ asset, reason: "must start with C" }];
    }
    if (asset.length !== 56) {
      return [{ asset, reason: "must be 56 characters" }];
    }
    if (!StrKey.isValidContract(asset)) {
      return [{ asset, reason: "must have a valid Stellar contract checksum" }];
    }
    return [];
  });
}