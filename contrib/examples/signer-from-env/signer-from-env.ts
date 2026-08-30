// Standalone example: build a `createSessionKeySigner` from an ed25519
// secret read out of an environment variable, failing loudly and clearly
// when the variable is missing or malformed. See ./README.md for the env
// var name and a warning about handling real secrets.

import { createSessionKeySigner } from "../../../src/x402-signer";
import type { SmartAccountX402Signer } from "../../../src/x402-types";

/** Default environment variable name this example reads the session-key
 * secret from. Override with the `envVarName` argument if your app uses a
 * different name. */
export const DEFAULT_ENV_VAR = "VELLAR_SESSION_KEY_SECRET";

/**
 * Reads a Stellar ed25519 secret seed (`S…`) from `process.env[envVarName]`
 * and wraps it in a `createSessionKeySigner` for the given smart-account
 * `address`. Throws a descriptive error — rather than letting a cryptic
 * failure surface later — when the variable is unset, empty, or does not
 * look like a Stellar secret key.
 */
export function createSessionKeySignerFromEnv(
  address: string,
  envVarName: string = DEFAULT_ENV_VAR,
): SmartAccountX402Signer {
  const secretKey = process.env[envVarName];
  if (!secretKey || secretKey.trim() === "") {
    throw new Error(
      `signer-from-env: environment variable "${envVarName}" is not set. ` +
        `Set it to an ed25519 session key secret (starts with "S") before calling createSessionKeySignerFromEnv().`,
    );
  }
  if (!secretKey.startsWith("S") || secretKey.length !== 56) {
    throw new Error(
      `signer-from-env: environment variable "${envVarName}" does not look like a Stellar secret key ` +
        `(expected a 56-character string starting with "S").`,
    );
  }
  return createSessionKeySigner({ address, secretKey });
}

export async function main(): Promise<void> {
  const address = process.env["VELLAR_WALLET_ADDRESS"];
  if (!address) {
    throw new Error(
      'signer-from-env: environment variable "VELLAR_WALLET_ADDRESS" is not set (the smart-account C-address to sign for).',
    );
  }
  const signer = createSessionKeySignerFromEnv(address);
  console.log(`session-key signer ready for ${signer.address}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
