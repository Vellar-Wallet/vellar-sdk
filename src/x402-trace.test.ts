import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createX402Client } from "./x402-client";
import {
  C_ADDRESS,
  PAYTO,
  SIM_SOURCE,
  TOKEN,
  b64,
  requirements,
  response402,
} from "./x402-test-fixtures";
import {
  REDACTED_SECRET,
  REDACTED_SIGNED_MATERIAL,
  createX402TraceRecorder,
  redactSensitiveTraceData,
} from "./x402-trace";

const MOCK_SECRET_SEED =
  "SB7ZMP5432109876543210987654321098765432109876543210ABCD";
const MOCK_TX_XDR =
  "AAAAAgAAAAD1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ==";
const MOCK_SETTLEMENT_TX_HASH =
  "a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123";

function buildValidAuthEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(C_ADDRESS).toScAddress(),
        nonce: xdr.Int64.fromString("42"),
        signatureExpirationLedger: 554433,
        signature: xdr.ScVal.scvVoid(),
      })
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(TOKEN).toScAddress(),
            functionName: "transfer",
            args: [
              nativeToScVal(C_ADDRESS, { type: "address" }),
              nativeToScVal(PAYTO, { type: "address" }),
              nativeToScVal(250_000n, { type: "i128" }),
            ],
          })
        ),
      subInvocations: [],
    }),
  });
}

describe("x402 payment flow trace export (#680)", () => {
  beforeEach(() => {
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
      id: "ledger-1",
      protocolVersion: 22,
      sequence: 554400,
    });
    vi.spyOn(AssembledTransaction, "build").mockResolvedValue({
      built: {
        operations: [{ auth: [buildValidAuthEntry()] }],
        toXDR: () => MOCK_TX_XDR,
      },
    } as unknown as AssembledTransaction<unknown>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a full 5-step x402 payment flow and redacts all signing material and secrets", async () => {
    const authEntryXdr = buildValidAuthEntry().toXDR("base64");
    const recorder = createX402TraceRecorder({
      network: "stellar:testnet",
    });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response402([requirements({ amount: "250000" })]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": b64({
              success: true,
              transaction: MOCK_SETTLEMENT_TX_HASH,
              network: "stellar:testnet",
              payer: C_ADDRESS,
            }),
          },
        })
      );

    const client = createX402Client({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      simulationSourceAccount: SIM_SOURCE,
      signer: {
        address: C_ADDRESS,
        async signAuthEntry(entryXdr) {
          return entryXdr;
        },
      },
      fetchImpl,
      traceRecorder: recorder,
    });

    const result = await client.fetch("https://api.example.com/v1/inference", {
      method: "POST",
      maxAmount: 1_000_000n,
      headers: {
        Authorization: `Bearer ${MOCK_SECRET_SEED}`,
      },
    });

    expect(result.paid).toBe(true);
    expect(result.trace).toBeDefined();

    const trace = recorder.getTrace();
    expect(trace.traceVersion).toBe(1);
    expect(trace.redacted).toBe(true);
    expect(trace.steps.map((s) => s.step)).toEqual([
      "discovery",
      "quote",
      "sign",
      "submit",
      "settlement",
    ]);

    const json = recorder.exportToJson();
    expect(json).not.toContain(MOCK_SECRET_SEED);
    expect(json).not.toContain(MOCK_TX_XDR);
    expect(json).not.toContain(authEntryXdr);
    expect(json).toContain(REDACTED_SIGNED_MATERIAL);
    expect(json).toContain(REDACTED_SECRET);
    // Non-sensitive settlement transaction hash and payment amount remain visible for support debugging
    expect(json).toContain(MOCK_SETTLEMENT_TX_HASH);
    expect(json).toContain("250000");
  });

  it("redacts secrets and signing material BEFORE writing to disk even when submit crashes mid-flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vellar-trace-680-"));
    const tracePath = path.join(tmpDir, "crash-trace.json");

    try {
      const recorder = createX402TraceRecorder({
        network: "stellar:testnet",
        outputFilePath: tracePath,
      });

      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          response402([requirements({ amount: "250000" })])
        )
        .mockRejectedValueOnce(
          new Error(
            `Upstream facilitator connection reset while using key ${MOCK_SECRET_SEED}`
          )
        );

      const client = createX402Client({
        network: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        simulationSourceAccount: SIM_SOURCE,
        signer: {
          address: C_ADDRESS,
          async signAuthEntry(entryXdr) {
            return entryXdr;
          },
        },
        fetchImpl,
        traceRecorder: recorder,
      });

      await expect(
        client.fetch("https://api.example.com/v1/inference", {
          maxAmount: 1_000_000n,
        })
      ).rejects.toThrow();

      // Verify the flushed file on disk already has all secrets and signed XDRs redacted
      expect(fs.existsSync(tracePath)).toBe(true);
      const rawDiskContent = fs.readFileSync(tracePath, "utf8");
      expect(rawDiskContent).not.toContain(MOCK_SECRET_SEED);
      expect(rawDiskContent).not.toContain(MOCK_TX_XDR);

      const diskTrace = JSON.parse(rawDiskContent);
      expect(diskTrace.steps.map((s: { step: string }) => s.step)).toEqual([
        "discovery",
        "quote",
        "sign",
        "submit",
      ]);
      const submitStep = diskTrace.steps[3];
      expect(submitStep.outcome).toBe("error");
      expect(submitStep.error).toContain(REDACTED_SECRET);
      expect(submitStep.request.headers["PAYMENT-SIGNATURE"]).toBe(
        REDACTED_SIGNED_MATERIAL
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("redactSensitiveTraceData scrubs nested secrets, headers, and Soroban XDR blobs", () => {
    const sanitized = redactSensitiveTraceData({
      secretKey: MOCK_SECRET_SEED,
      headers: {
        "PAYMENT-SIGNATURE": "eyJ4NDAyVmVyc2lvbiI6Mn0=",
        Authorization: "Bearer super-secret-jwt",
      },
      payload: {
        transaction: MOCK_TX_XDR,
        signature: MOCK_TX_XDR,
      },
      settlement: {
        transaction: MOCK_SETTLEMENT_TX_HASH,
      },
    }) as Record<string, any>;

    expect(sanitized.secretKey).toBe(REDACTED_SECRET);
    expect(sanitized.headers["PAYMENT-SIGNATURE"]).toBe(
      REDACTED_SIGNED_MATERIAL
    );
    expect(sanitized.headers.Authorization).toBe(REDACTED_SECRET);
    expect(sanitized.payload.transaction).toBe(REDACTED_SIGNED_MATERIAL);
    expect(sanitized.payload.signature).toBe(REDACTED_SIGNED_MATERIAL);
    expect(sanitized.settlement.transaction).toBe(MOCK_SETTLEMENT_TX_HASH);
  });
});
