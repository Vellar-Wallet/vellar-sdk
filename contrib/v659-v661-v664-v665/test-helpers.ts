// Shared test harness for this folder's x402 tests.
//
// Drives the REAL `createX402Client` end to end without a network: Soroban RPC
// calls are answered from the captured testnet recording that
// contrib/v389-v386-v383-v390 and packages/mcp-x402-payer already use, so the
// auth entry the signer sees is a genuine, well-formed transfer. Mocking
// `rpc.Server.prototype` (rather than adding an `allowHttp` escape hatch to
// src/) keeps every change inside contrib/, per CONTRIBUTING.md.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, rpc } from "@stellar/stellar-sdk";
import { vi } from "vitest";
import type { PaymentRequirements, SmartAccountX402Signer } from "../../src/x402-types.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "mcp-x402-payer",
  "test",
  "fixtures",
  "soroban-rpc-recording.json",
);

/** The wallet, asset and recipient the recording was captured with. */
export const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PAY_TO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
export const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
export const RPC_URL = "https://soroban-testnet.stellar.org";

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Array<{
  method: string;
  response: { result: Record<string, unknown> };
}>;
const rawSimulation = fixture.find((e) => e.method === "simulateTransaction")!.response.result;
const rawLedger = fixture.find((e) => e.method === "getLatestLedger")!.response.result;

/** Answer every Soroban RPC call from the recording. Call in `beforeEach`. */
export function mockSorobanRpcFromRecording() {
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockImplementation(
    async () => rawLedger as never,
  );
  vi.spyOn(rpc.Server.prototype, "getAccount").mockImplementation(
    async (address: string) => new Account(address, "1") as never,
  );
  const simulateTransaction = vi
    .spyOn(rpc.Server.prototype, "simulateTransaction")
    .mockImplementation(
      async () => rpc.parseRawSimulation(structuredClone(rawSimulation) as never) as never,
    );
  return { simulateTransaction };
}

/** The payment terms that match the recording. */
export function recordedRequirements(
  over: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "1000000",
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

/** Browser-safe base64 JSON, as servers encode the x402 headers. */
export function b64(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** A 402 challenge whose PAYMENT-REQUIRED header carries `body` verbatim. */
export function challenge(body: unknown): Response {
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": b64(body) } });
}

/** A signer that records every entry it is asked to sign and returns it as-is. */
export function recordingSigner(): { calls: string[]; signer: SmartAccountX402Signer } {
  const calls: string[] = [];
  return {
    calls,
    signer: {
      address: WALLET,
      async signAuthEntry(entryXdr: string) {
        calls.push(entryXdr);
        return entryXdr;
      },
    },
  };
}
