// Network configuration constants a consumer needs to construct PasskeyKit and
// SACClient. These are easy to get wrong or not know at all, so the SDK ships
// them. The wasm hash is the canonical passkey-kit v1 testnet smart-wallet
// contract — it MUST match the passkey-kit version (see the passkey-kit
// deployment manifest); re-check it on every passkey-kit upgrade.

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
  walletWasmHash:
    "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0",
  nativeTokenContractId:
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
};
