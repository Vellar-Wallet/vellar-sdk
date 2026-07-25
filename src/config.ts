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
}

export const TESTNET: NetworkConfig = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  walletWasmHash: "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0",
  nativeTokenContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
};

// ---------------------------------------------------------------------------
// Mainnet.
//
// STATUS: mainnet use of this SDK is pending a security review. Shipping this
// config does NOT make mainnet blessed — it removes the "I cannot even target
// mainnet" wall for the values that ARE knowable, and forces the two that are
// not to be supplied explicitly rather than guessed.
//
// Three fields are published by SDF / derivable and are filled below:
//   - networkPassphrase      (the canonical mainnet passphrase)
//   - horizonUrl             (SDF's public mainnet Horizon)
//   - nativeTokenContractId  (the XLM SAC id — deterministic, derived from the
//     asset + mainnet passphrase; config.test verifies the derivation)
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
};

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
 * XLM SAC id) are filled in. Throws if either required value is missing or
 * malformed, so a broken mainnet config can never be constructed silently.
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
