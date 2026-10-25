// LOCAL-TESTING-ONLY EXAMPLE — NEVER SUITABLE FOR A REAL MAINNET TRANSACTION.
//
// Issue #633: Demonstrates constructing a mainnet `NetworkConfig` via
// `mainnetConfig({ rpcUrl, walletWasmHash })` pointed at a local mock Soroban
// RPC server, and verifying that the resulting configuration passes the same
// validation path used for a real mainnet deployment without requiring a paid
// mainnet Soroban RPC provider or real funds.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";
import {
  MAINNET,
  MainnetConfigError,
  TESTNET,
  mainnetConfig,
  type NetworkConfig,
} from "../../src/config";
import { createVellarWallet } from "../../src/client";

/**
 * LOCAL-TESTING-ONLY synthetic 64-character hex WASM hash.
 *
 * WARNING: This value is a deterministic local test placeholder and is NEVER
 * suitable for a real mainnet transaction. For real mainnet deployments, verify
 * the smart-wallet WASM hash against the official passkey-kit mainnet deployment
 * manifest for your exact passkey-kit version.
 */
export const LOCAL_TEST_ONLY_MAINNET_WASM_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export interface MockMainnetRpcOptions {
  /** Override the network passphrase reported by `getNetwork` (for failure-mode tests). */
  networkPassphrase?: string;
  /** Override the health status reported by `getHealth` (default: "healthy"). */
  healthStatus?: "healthy" | "unhealthy";
  /** Starting ledger sequence reported by `getLatestLedger` (default: 55_000_000). */
  latestLedgerSequence?: number;
  /** Protocol version reported by `getNetwork` and `getLatestLedger` (default: 22). */
  protocolVersion?: number;
}

export interface MockMainnetRpcServer {
  /** Local HTTP URL (`http://127.0.0.1:<port>`) for the mock Soroban RPC provider. */
  readonly rpcUrl: string;
  /** Recorded JSON-RPC method names received by this mock server. */
  readonly requests: Array<{ id: number | string | null; method: string; params: unknown }>;
  /** Shut down the local HTTP server. */
  close(): Promise<void>;
}

/**
 * Start a local, hermetic JSON-RPC 2.0 mock Soroban RPC server on `127.0.0.1:0`.
 *
 * LOCAL-TESTING-ONLY: Emulates the read-only Soroban RPC methods (`getHealth`,
 * `getNetwork`, `getLatestLedger`) needed to validate a mainnet `NetworkConfig`
 * locally without contacting any external provider.
 */
export async function startMockMainnetRpcServer(
  options: MockMainnetRpcOptions = {},
): Promise<MockMainnetRpcServer> {
  const passphrase = options.networkPassphrase ?? MAINNET.networkPassphrase;
  const healthStatus = options.healthStatus ?? "healthy";
  const latestLedgerSequence = options.latestLedgerSequence ?? 55_000_000;
  const protocolVersion = options.protocolVersion ?? 22;
  const requests: Array<{ id: number | string | null; method: string; params: unknown }> = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let rawBody = "";
    for await (const chunk of req) {
      rawBody += chunk;
    }

    let parsed: { id?: number | string | null; method?: string; params?: unknown };
    try {
      parsed = JSON.parse(rawBody || "{}") as {
        id?: number | string | null;
        method?: string;
        params?: unknown;
      };
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }),
      );
      return;
    }

    const id = parsed.id ?? 1;
    const method = parsed.method ?? "";
    requests.push({ id, method, params: parsed.params });

    const reply = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    };

    switch (method) {
      case "getHealth":
        reply({
          status: healthStatus,
          latestLedger: latestLedgerSequence,
          oldestLedger: latestLedgerSequence - 17_280,
          ledgerRetentionWindow: 17_280,
        });
        return;

      case "getNetwork":
        reply({
          passphrase,
          protocolVersion,
        });
        return;

      case "getLatestLedger":
        reply({
          id: "b".repeat(64),
          protocolVersion,
          sequence: latestLedgerSequence,
        });
        return;

      default:
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          }),
        );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const rpcUrl = `http://127.0.0.1:${addr.port}`;

  return {
    rpcUrl,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface MainnetValidationReport {
  valid: true;
  localTestingOnly: true;
  config: NetworkConfig;
  derivedNativeSacId: string;
  derivedUsdcSacId: string;
  rpcNetworkPassphrase: string;
  rpcLatestLedger: number;
}

/**
 * Validate a mainnet `NetworkConfig` constructed via `mainnetConfig()` using the
 * same invariants enforced for a real mainnet deployment:
 *
 * 1. `network` is `"mainnet"` and `networkPassphrase` equals `Networks.PUBLIC`.
 * 2. `rpcUrl` is a well-formed HTTP(S) URL and `walletWasmHash` is a 64-char
 *    lowercase hex digest that is NOT copied from `TESTNET.walletWasmHash`.
 * 3. `nativeTokenContractId` matches the deterministic SAC derivation for XLM
 *    on `Networks.PUBLIC`.
 * 4. `usdcIssuer` matches Circle's official mainnet issuer (`MAINNET.usdcIssuer`)
 *    and `usdcContractId` matches the deterministic SAC derivation for USDC on
 *    `Networks.PUBLIC`.
 */
export function validateMainnetNetworkConfig(config: NetworkConfig): {
  derivedNativeSacId: string;
  derivedUsdcSacId: string;
} {
  if (config.network !== "mainnet") {
    throw new MainnetConfigError(
      `Expected network to be "mainnet", got ${JSON.stringify(config.network)}.`,
    );
  }
  if (config.networkPassphrase !== Networks.PUBLIC) {
    throw new MainnetConfigError(
      `Expected canonical mainnet passphrase ${JSON.stringify(Networks.PUBLIC)}, got ${JSON.stringify(config.networkPassphrase)}.`,
    );
  }
  if (config.horizonUrl !== MAINNET.horizonUrl) {
    throw new MainnetConfigError(
      `Expected canonical mainnet Horizon URL ${JSON.stringify(MAINNET.horizonUrl)}, got ${JSON.stringify(config.horizonUrl)}.`,
    );
  }

  let parsedRpc: URL;
  try {
    parsedRpc = new URL(config.rpcUrl);
  } catch {
    throw new MainnetConfigError(`Invalid mainnet rpcUrl: ${JSON.stringify(config.rpcUrl)}.`);
  }
  if (parsedRpc.protocol !== "https:" && parsedRpc.protocol !== "http:") {
    throw new MainnetConfigError(
      `Mainnet rpcUrl must use https: (or http: for local mock testing), got ${JSON.stringify(parsedRpc.protocol)}.`,
    );
  }

  if (!/^[0-9a-f]{64}$/.test(config.walletWasmHash)) {
    throw new MainnetConfigError(
      "Mainnet walletWasmHash must be a normalized 64-character lowercase hex string.",
    );
  }
  if (config.walletWasmHash.toLowerCase() === TESTNET.walletWasmHash.toLowerCase()) {
    throw new MainnetConfigError(
      "Mainnet walletWasmHash must not reuse TESTNET.walletWasmHash — verify against the mainnet deployment manifest.",
    );
  }

  const derivedNativeSacId = Asset.native().contractId(config.networkPassphrase);
  if (config.nativeTokenContractId !== derivedNativeSacId) {
    throw new MainnetConfigError(
      `Mainnet nativeTokenContractId mismatch: expected ${derivedNativeSacId}, got ${config.nativeTokenContractId}.`,
    );
  }

  if (config.usdcIssuer !== MAINNET.usdcIssuer || !StrKey.isValidEd25519PublicKey(config.usdcIssuer)) {
    throw new MainnetConfigError(
      `Mainnet usdcIssuer must match Circle's official mainnet issuer (${MAINNET.usdcIssuer}).`,
    );
  }

  const derivedUsdcSacId = new Asset("USDC", config.usdcIssuer).contractId(config.networkPassphrase);
  if (config.usdcContractId !== derivedUsdcSacId) {
    throw new MainnetConfigError(
      `Mainnet usdcContractId mismatch: expected ${derivedUsdcSacId}, got ${config.usdcContractId}.`,
    );
  }

  return { derivedNativeSacId, derivedUsdcSacId };
}

async function callJsonRpc<T>(rpcUrl: string, method: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
  if (!res.ok) {
    throw new MainnetConfigError(`RPC ${method} failed with HTTP ${res.status}.`);
  }
  const body = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };
  if (body.error || !body.result) {
    throw new MainnetConfigError(
      `RPC ${method} returned error: ${body.error?.message ?? "missing result"}.`,
    );
  }
  return body.result;
}

export interface RunMainnetMockRpcExampleOptions {
  /** Optional custom `walletWasmHash` (defaults to `LOCAL_TEST_ONLY_MAINNET_WASM_HASH`). */
  walletWasmHash?: string;
  /** Optional mock RPC options (e.g. to simulate a wrong passphrase or unhealthy RPC). */
  mockRpcOptions?: MockMainnetRpcOptions;
  /** Optional custom logger (defaults to `console.log`). */
  log?: (line: string) => void;
  /** Optional custom `fetch` implementation. */
  fetchImpl?: typeof fetch;
}

/**
 * End-to-end local example:
 * 1. Starts a local mock Soroban RPC server on `127.0.0.1`.
 * 2. Constructs a `NetworkConfig` via `mainnetConfig({ rpcUrl, walletWasmHash })`.
 * 3. Validates all mainnet schema fields, SAC derivations, and RPC network passphrase.
 * 4. Wires a `createVellarWallet` instance on `"mainnet"` with the validated config.
 *
 * LOCAL-TESTING-ONLY — NEVER SUITABLE FOR A REAL MAINNET TRANSACTION.
 */
export async function runMainnetMockRpcExample(
  options: RunMainnetMockRpcExampleOptions = {},
): Promise<MainnetValidationReport> {
  const logger = options.log ?? ((line: string) => console.log(line));
  const fetchImpl = options.fetchImpl ?? fetch;
  const mockRpc = await startMockMainnetRpcServer(options.mockRpcOptions);

  try {
    logger(
      "[LOCAL-TESTING-ONLY] Starting mainnetConfig validation against local mock RPC (NEVER use for real mainnet transactions)",
    );

    const config = mainnetConfig({
      rpcUrl: mockRpc.rpcUrl,
      walletWasmHash: options.walletWasmHash ?? LOCAL_TEST_ONLY_MAINNET_WASM_HASH,
    });

    const { derivedNativeSacId, derivedUsdcSacId } = validateMainnetNetworkConfig(config);

    const health = await callJsonRpc<{ status: string; latestLedger: number }>(
      config.rpcUrl,
      "getHealth",
      fetchImpl,
    );
    if (health.status !== "healthy") {
      throw new MainnetConfigError(
        `Mock mainnet RPC reported unhealthy status: ${JSON.stringify(health.status)}.`,
      );
    }

    const netInfo = await callJsonRpc<{ passphrase: string; protocolVersion: number }>(
      config.rpcUrl,
      "getNetwork",
      fetchImpl,
    );
    if (netInfo.passphrase !== config.networkPassphrase) {
      throw new MainnetConfigError(
        `RPC network passphrase mismatch: expected ${JSON.stringify(config.networkPassphrase)}, got ${JSON.stringify(netInfo.passphrase)}.`,
      );
    }

    const latestLedger = await callJsonRpc<{ sequence: number }>(
      config.rpcUrl,
      "getLatestLedger",
      fetchImpl,
    );

    // Verify that `createVellarWallet` accepts the resulting mainnet configuration.
    const wallet = createVellarWallet({
      network: config.network,
      appName: "Vellar Mainnet Mock RPC Example (LOCAL-TESTING-ONLY)",
      rpcUrl: config.rpcUrl,
      kit: {
        createWallet: async () => ({
          keyIdBase64: "mock-key-id",
          contractId: config.nativeTokenContractId,
          signedTx: "AAAA",
        }),
        connectWallet: async () => ({
          keyIdBase64: "mock-key-id",
          contractId: config.nativeTokenContractId,
        }),
        sign: async (tx: unknown) => tx,
      },
      backend: {
        resolveContractId: async () => config.nativeTokenContractId,
        submitTransaction: async () => ({ hash: "a".repeat(64) }),
      },
      sac: {
        getSACClient: () => ({
          transfer: async () => ({ toXDR: () => "AAAA" }),
        }),
      },
      isValidAddress: (addr) =>
        StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr),
    });

    if (wallet.session !== null) {
      throw new MainnetConfigError("Expected fresh wallet session to be null before connect().");
    }

    logger(`[LOCAL-TESTING-ONLY] Validated mainnetConfig against ${config.rpcUrl}`);
    logger(`[LOCAL-TESTING-ONLY] Native XLM SAC: ${derivedNativeSacId}`);
    logger(`[LOCAL-TESTING-ONLY] Circle USDC SAC: ${derivedUsdcSacId}`);
    logger(`[LOCAL-TESTING-ONLY] Mock RPC latest ledger: ${latestLedger.sequence}`);

    return {
      valid: true,
      localTestingOnly: true,
      config,
      derivedNativeSacId,
      derivedUsdcSacId,
      rpcNetworkPassphrase: netInfo.passphrase,
      rpcLatestLedger: latestLedger.sequence,
    };
  } finally {
    await mockRpc.close();
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runMainnetMockRpcExample().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
