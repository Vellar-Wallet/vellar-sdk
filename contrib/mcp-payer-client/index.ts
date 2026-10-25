// Standalone contrib example (#632): Spawns the Vellar MCP x402 payer server as
// a child process over stdio, performs the MCP `initialize` and `tools/list`
// handshake from a minimal `@modelcontextprotocol/sdk` Client, and drives
// `x402_quote`, `x402_pay`, and `x402_session_budget` against a local mock
// resource/facilitator server using a throwaway non-production test keypair.
//
// SECURITY NOTE: This example generates an ephemeral throwaway Stellar keypair
// (`Keypair.random()`) at runtime. Never hardcode or commit real `S...` secret
// seeds into source files or pass them as MCP tool arguments.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Keypair } from "@stellar/stellar-sdk";
import { buildSync } from "esbuild";
import {
  ASSET_A,
  PAYTO,
  b64,
  challenge,
  requirement,
  txHash,
} from "../../packages/mcp-x402-payer/test/helpers.js";
import type { X402Challenge } from "../../packages/mcp-x402-payer/src/protocol.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/**
 * Generate a NON-PRODUCTION throwaway Stellar Ed25519 keypair for local/CI
 * testing of the MCP payer over stdio.
 *
 * WARNING: NON-PRODUCTION TEST KEYPAIR ONLY — never fund this account on
 * mainnet or reuse this helper for production key management.
 */
export function createThrowawayTestKeypair(): {
  readonly nonProductionTestOnly: true;
  readonly publicKey: string;
  readonly secret: string;
} {
  const kp = Keypair.random();
  return {
    nonProductionTestOnly: true,
    publicKey: kp.publicKey(),
    secret: kp.secret(),
  };
}

export interface MockFacilitatorResourceOptions {
  /** Price in base units advertised in the 402 challenge (default: "1000"). */
  amount?: string;
  /** Asset contract ID advertised in the 402 challenge (default: `ASSET_A`). */
  asset?: string;
  /** Network CAIP-2 identifier (default: "stellar:testnet"). */
  network?: string;
  /** Recipient address (default: `PAYTO`). */
  payTo?: string;
  /** Unlocked body returned after a signed payment retry. */
  unlockedBody?: string;
  /**Deterministic label for the 64-hex settlement transaction hash. */
  settlementTxLabel?: string;
  /** When set, the paid retry returns HTTP 402 with this rejection reason instead of settling. */
  rejectPaidRetryWith?: string;
}

export interface MockFacilitatorResourceServer {
  readonly resourceUrl: string;
  readonly settlementHash: string;
  readonly requests: Array<{ method: string; url: string; paymentSignature?: string }>;
  close(): Promise<void>;
}

/**
 * Start a local HTTP server that emulates an x402-protected resource backed by
 * a mocked/recorded facilitator settlement response:
 * - Unpaid `GET /resource` -> HTTP 402 with `PAYMENT-REQUIRED` header (x402 v2).
 * - Paid `GET /resource` (carrying `PAYMENT-SIGNATURE`) -> HTTP 200 with
 *   `X-PAYMENT-RESPONSE` settlement header and the unlocked resource payload.
 */
export async function startMockFacilitatorResourceServer(
  options: MockFacilitatorResourceOptions = {},
): Promise<MockFacilitatorResourceServer> {
  const amount = options.amount ?? "1000";
  const asset = options.asset ?? ASSET_A;
  const network = options.network ?? "stellar:testnet";
  const payTo = options.payTo ?? PAYTO;
  const unlockedBody =
    options.unlockedBody ??
    JSON.stringify({
      ok: true,
      message: "Ships are safe in harbor, but that is not what ships are built for.",
    });
  const settlementHash = txHash(options.settlementTxLabel ?? "contrib-mcp-payer-632");
  const requests: Array<{ method: string; url: string; paymentSignature?: string }> = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const paymentSig =
      (req.headers["payment-signature"] as string | undefined) ??
      (req.headers["x-payment"] as string | undefined);
    const reqUrl = req.url ?? "/resource";
    requests.push({
      method: req.method ?? "GET",
      url: reqUrl,
      ...(paymentSig ? { paymentSignature: paymentSig } : {}),
    });

    if (!paymentSig) {
      const resourceChallenge: X402Challenge = challenge([
        requirement({
          scheme: "exact",
          network,
          asset,
          amount,
          payTo,
          maxTimeoutSeconds: 120,
          extra: { areFeesSponsored: true },
        }),
      ]);
      res.writeHead(402, {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": b64(resourceChallenge),
      });
      res.end(JSON.stringify({ error: "Payment required" }));
      return;
    }

    if (options.rejectPaidRetryWith) {
      res.writeHead(402, {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": b64({
          x402Version: 2,
          error: options.rejectPaidRetryWith,
          accepts: [],
        }),
      });
      res.end(
        JSON.stringify({
          error: "x402_failed",
          stage: "verify",
          detail: options.rejectPaidRetryWith,
        }),
      );
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json",
      "X-PAYMENT-RESPONSE": b64({
        success: true,
        transaction: settlementHash,
        payer: payTo,
        network,
      }),
    });
    res.end(unlockedBody);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const resourceUrl = `http://127.0.0.1:${addr.port}/resource`;

  return {
    resourceUrl,
    settlementHash,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Bundle a hermetic stdio entrypoint for `vellar-mcp-x402-payer` into a
 * temporary directory so the example can spawn the MCP payer binary as a child
 * process over stdio without requiring a prior `npm run build` or external
 * Soroban RPC / Horizon network access.
 */
export function buildHermeticMcpPayerBinary(): {
  binPath: string;
  cleanup: () => void;
} {
  const cacheRoot = resolve(REPO_ROOT, "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const tempDir = mkdtempSync(join(cacheRoot, "vellar-mcp-payer-632-"));
  const binPath = join(tempDir, "mcp-payer-stdio.mjs");

  const entrySource = `
import { Keypair } from "@stellar/stellar-sdk";
import { loadConfig } from ${JSON.stringify(resolve(REPO_ROOT, "packages/mcp-x402-payer/src/config.ts"))};
import { createSpendLedger } from ${JSON.stringify(resolve(REPO_ROOT, "packages/mcp-x402-payer/src/ledger.ts"))};
import { formatError, log, registerSecret } from ${JSON.stringify(resolve(REPO_ROOT, "packages/mcp-x402-payer/src/output.ts"))};
import { createPayer } from ${JSON.stringify(resolve(REPO_ROOT, "packages/mcp-x402-payer/src/payer.ts"))};
import { createMcpServer, startStdio } from ${JSON.stringify(resolve(REPO_ROOT, "packages/mcp-x402-payer/src/server.ts"))};

async function main() {
  const config = loadConfig();
  registerSecret(config.secret);
  const ledger = createSpendLedger(config.ceilings);
  const keypair = Keypair.fromSecret(config.secret);

  const signer = {
    address: keypair.publicKey(),
    async signPayment(narrowedChallenge) {
      const payloadBytes = Buffer.from(JSON.stringify(narrowedChallenge), "utf8");
      const sigBytes = keypair.sign(payloadBytes);
      const envelope = {
        x402Version: 2,
        scheme: "exact",
        network: config.caip2,
        payer: keypair.publicKey(),
        signature: Buffer.from(sigBytes).toString("base64"),
      };
      return {
        "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
      };
    },
  };

  const payer = createPayer({ config, ledger, signer });
  log("info", "vellar x402 payer ready", {
    network: config.network,
    payer: signer.address,
    assets: config.allowedAssets.length,
    spendLimit: "process-only (non-production test keypair)",
  });

  await startStdio(createMcpServer({ payer, config, ledger }));
}

main().catch((err) => {
  process.stderr.write(\`vellar-mcp-x402-payer failed to start: \${formatError(err)}\\n\`);
  process.exit(1);
});
`;

  buildSync({
    stdin: {
      contents: entrySource,
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: binPath,
    external: [
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/sdk/*",
      "@stellar/stellar-sdk",
      "zod",
    ],
    alias: {
      "vellar-sdk/x402-guards": resolve(REPO_ROOT, "src/x402-guards.ts"),
      "vellar-sdk/x402-untrusted": resolve(REPO_ROOT, "src/x402-untrusted.ts"),
    },
  });

  return {
    binPath,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on Windows file locks.
      }
    },
  };
}

/** Extract concatenated text blocks from an MCP `callTool` response. */
export function extractToolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((block) => block.text ?? "").join("\n");
}

export interface RunMcpPayerClientExampleOptions {
  /** Max amount in base units passed to `x402_pay` (default: "5000"). */
  maxAmount?: string;
  /** Per-asset session ceiling configured on the MCP payer (default: "1000000"). */
  sessionCeiling?: string;
  /** Options for the local mock facilitator/resource server. */
  mockServerOptions?: MockFacilitatorResourceOptions;
  /** Optional logger function (defaults to `console.log`). */
  log?: (line: string) => void;
}

export interface McpPayerClientExampleResult {
  readonly nonProductionKeypairPublicKey: string;
  readonly serverInfo: { name: string; version: string } | undefined;
  readonly toolNames: string[];
  readonly quoteText: string;
  readonly payText: string;
  readonly payIsError: boolean;
  readonly settlementHash: string | undefined;
  readonly budgetBeforeText: string;
  readonly budgetAfterText: string;
  readonly stderrOutput: string;
}

/**
 * Spawn the MCP payer server over stdio, perform the MCP `initialize` and
 * `tools/list` handshake, quote the resource, call `x402_pay`, and inspect the
 * remaining session budget.
 */
export async function runMcpPayerClientExample(
  options: RunMcpPayerClientExampleOptions = {},
): Promise<McpPayerClientExampleResult> {
  const logger = options.log ?? ((line: string) => console.log(line));
  const maxAmount = options.maxAmount ?? "5000";
  const sessionCeiling = options.sessionCeiling ?? "1000000";

  // 1. Generate a throwaway NON-PRODUCTION test keypair (never committed to git).
  const testKeypair = createThrowawayTestKeypair();
  logger(
    `[NON-PRODUCTION TEST KEYPAIR] Generated throwaway payer public key: ${testKeypair.publicKey}`,
  );

  // 2. Start a local mock resource/facilitator server returning an x402 v2 challenge
  //    followed by a recorded settlement header on paid retry.
  const mockResource = await startMockFacilitatorResourceServer(options.mockServerOptions);
  const { binPath, cleanup } = buildHermeticMcpPayerBinary();

  let stderrOutput = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env: {
      PATH: process.env.PATH ?? "",
      VELLAR_X402_SECRET: testKeypair.secret,
      VELLAR_X402_ASSETS: `${ASSET_A}:${sessionCeiling}`,
      VELLAR_X402_NETWORK: "testnet",
    },
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer | string) => {
      stderrOutput += String(chunk);
    });
  }

  const client = new Client({
    name: "vellar-contrib-minimal-mcp-client",
    version: "1.0.0",
  });

  try {
    // 3. Connect over stdio (performs the MCP `initialize` handshake).
    await client.connect(transport);
    const serverInfo = client.getServerVersion();
    logger(
      `[MCP Handshake] Connected to ${serverInfo?.name ?? "unknown"}@${serverInfo?.version ?? "0.0.0"}`,
    );

    // 4. List available MCP tools (`tools/list`).
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    logger(`[MCP tools/list] Available tools: ${toolNames.join(", ")}`);

    // 5. Check initial session budget (`x402_session_budget`).
    const budgetBefore = await client.callTool({
      name: "x402_session_budget",
      arguments: {},
    });
    const budgetBeforeText = extractToolText(budgetBefore);

    // 6. Quote the x402 resource without spending (`x402_quote`).
    const quoteResult = await client.callTool({
      name: "x402_quote",
      arguments: { resource_url: mockResource.resourceUrl },
    });
    const quoteText = extractToolText(quoteResult);
    logger(`[MCP x402_quote]\n${quoteText}`);

    // 7. Call `x402_pay` to sign and settle the payment against the mock facilitator.
    const payResult = await client.callTool({
      name: "x402_pay",
      arguments: {
        resource_url: mockResource.resourceUrl,
        max_amount: maxAmount,
      },
    });
    const payText = extractToolText(payResult);
    const payIsError = Boolean(payResult.isError);
    const settlementHash = payText.match(/Settlement transaction: ([0-9a-f]{64})/)?.[1];
    logger(`[MCP x402_pay] isError=${payIsError} settlementHash=${settlementHash ?? "none"}`);

    // 8. Check post-payment session budget (`x402_session_budget`).
    const budgetAfter = await client.callTool({
      name: "x402_session_budget",
      arguments: {},
    });
    const budgetAfterText = extractToolText(budgetAfter);

    return {
      nonProductionKeypairPublicKey: testKeypair.publicKey,
      serverInfo,
      toolNames,
      quoteText,
      payText,
      payIsError,
      settlementHash,
      budgetBeforeText,
      budgetAfterText,
      stderrOutput,
    };
  } finally {
    await client.close().catch(() => {});
    await mockResource.close().catch(() => {});
    cleanup();
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runMcpPayerClientExample().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
