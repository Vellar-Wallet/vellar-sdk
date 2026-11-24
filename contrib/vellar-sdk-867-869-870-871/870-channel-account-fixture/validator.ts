// Validation for the exact CHANNEL_ACCOUNT_SECRET_KEYS format consumed by a
// local facilitator (issue #870). Reference implementation under contrib/.
//
// The facilitator requires exactly 50 comma separated Stellar classic secret
// keys, with no duplicates and with the sponsor key excluded (the sponsor is a
// separate environment variable, so this validator only checks the list
// itself).

import { StrKey } from "@stellar/stellar-sdk";
import { CHANNEL_ACCOUNT_COUNT } from "./channel-account-keys.mjs";

export interface ChannelKeysValidation {
  valid: boolean;
  errors: string[];
}

export function validateChannelAccountSecretKeys(raw: string): ChannelKeysValidation {
  const errors: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, errors: ["CHANNEL_ACCOUNT_SECRET_KEYS is empty"] };
  }

  const keys = trimmed.split(",");
  if (keys.length !== CHANNEL_ACCOUNT_COUNT) {
    errors.push(
      `expected exactly ${CHANNEL_ACCOUNT_COUNT} comma separated keys, got ${keys.length}`,
    );
  }

  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!.trim();
    if (!StrKey.isValidEd25519SecretSeed(key)) {
      errors.push(`key ${i + 1} is not a valid Stellar classic secret`);
    }
    if (seen.has(key)) {
      errors.push(`key ${i + 1} duplicates an earlier key`);
    }
    seen.add(key);
  }

  return { valid: errors.length === 0, errors };
}
