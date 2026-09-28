// V-1 end-to-end proof for the PRIMARY path: `createX402Client` (backs
// `wallet.x402.fetch`, the path vellar-dapp depends on).
//
// packages/mcp-x402-payer/test/hostile-rpc.test.ts already proves V-1 for the
// MCP agent payer's own scheme client (`createSmartAccountScheme`). That client
// is a separate implementation living in a different package — this file
// drives THIS package's `createX402Client` the same way, against the same
// captured testnet fixture, so the primary consumer path has the same black
// box proof rather than resting on unit coverage of `assertAuthEntryInvocation`
// in isolation plus the original fix commit diff.
//
// Style mirrors the sibling test deliberately: a stub Soroban RPC replays a
// real captured `simulateTransaction` response with only the recipient
// mutated, so the auth entry is genuinely well-formed and correctly
// credentialed to our wallet — it passes the credential-address check that
// already existed. The only thing changed is the RECIPIENT inside the
// invocation. A unit assertion on the comparison function would not do: it
// would pass against a vulnerable version that never called it. The assertion
// that matters is that the SIGNER IS NEVER REACHED.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthEntryMismatchError } from "./x402-auth-entry";
import { createX402Client } from "./x402-client";
import type { PaymentRequirements, SmartAccountX402Signer } from "./x402-types";

// Captured from live testnet for packages/mcp-x402-payer's own hostile-RPC
// proof — reused verbatim rather than re-recording, so both proofs are
// checked against the identical real `simulateTransaction` response.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "mcp-x402-payer",
  "test",
  "fixtures",
  "soroban-rpc-recording.json",
);

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const HONEST_PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const ATTACKER = "GB74DDOZVF4SX3SEB2HNXJTKDBEKI4PH7N6GUWAFLG76XJBX27AOW2YB";
const PORT = 4211; // distinct from the sibling test's 4210 — both may run concurrently.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Array<{
  method: string;
  response: { result: Record<string, unknown> };
}>;

const simulation = fixture.find((e) => e.method === "simulateTransaction")!.response.result as {
  results?: Array<{ auth?: string[] }>;
  [k: string]: unknown;
};
/** Replayed verbatim — the SDK XDR-decodes fields a hand-written stub gets wrong. */
const latestLedger = fixture.find((e) => e.method === "getLatestLedger")!.response.result;

// `createX402Client` (unlike the sibling scheme client) simulates from a real
// classic source account rather than NULL_ACCOUNT, so `AssembledTransaction`
// fetches it via `getLedgerEntries` before simulating. The fixture doesn't
// carry that entry (the source account is never itself part of the payment),
// so the stub synthesizes one for the account this test uses as the
// simulation source — the SDK only reads its sequence number.
const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
const simSourceAccountKey = xdr.LedgerKey.account(
  new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(SIM_SOURCE).xdrPublicKey() }),
).toXDR("base64");
const simSourceAccountEntry = xdr.LedgerEntryData.account(
  new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(SIM_SOURCE).xdrPublicKey(),
    balance: xdr.Int64.fromString("1000000000"),
    // stellar-sdk's xdr namespace type doesn't export `SequenceNumber` even
    // though it exists at runtime (used internally by AccountEntry's own
    // generated type) — cast around the gap rather than fighting it.
    seqNum: (xdr as unknown as { SequenceNumber: { fromString(v: string): xdr.Int64 } })
      .SequenceNumber.fromString("1"),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Buffer.from([0, 0, 0, 0]),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  }),
).toXDR("base64");

/** Rewrite the recipient inside a real auth entry, leaving everything else intact. */
function redirectRecipient(authXdr: string, to: string): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(authXdr, "base64");
  const call = entry.rootInvocation().function().contractFn();
  const args = call.args();
  args[1] = nativeToScVal(to, { type: "address" });
  call.args(args);
  return entry.toXDR("base64");
}

/** Swapped per test; the single server below reads it on each request. */
let mutate: (sim: typeof simulation) => typeof simulation = (sim) => sim;

/** One Soroban RPC stub for the whole file — a server per test races on the port. */
function hostileRpc(): Server {
  return createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const { id, method } = JSON.parse(body) as { id: number; method: string };

    const reply = (result: unknown) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id, result }));

    if (method === "simulateTransaction") return reply(mutate(structuredClone(simulation)));
    if (method === "getLatestLedger") return reply(latestLedger);
    if (method === "getLedgerEntries") {
      return reply({
        entries: [
          {
            key: simSourceAccountKey,
            xdr: simSourceAccountEntry,
            lastModifiedLedgerSeq: (latestLedger as { sequence: number }).sequence,
          },
        ],
        latestLedger: (latestLedger as { sequence: number }).sequence,
      });
    }
    return reply({});
  });
}

/** A signer that records whether it was ever asked to sign. */
function trackingSigner(): { calls: string[]; signer: SmartAccountX402Signer } {
  const calls: string[] = [];
  return {
    calls,
    signer: {
      address: WALLET,
      async signAuthEntry(entryXdr: string) {
        calls.push(entryXdr);
        return entryXdr; // never reached in the hostile case
      },
    },
  };
}

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "1000000",
  asset: USDC,
  payTo: HONEST_PAYTO,
  maxTimeoutSeconds: 120,
  extra: { areFeesSponsored: true },
};

let server: Server;

function client(signer: SmartAccountX402Signer) {
  return createX402Client({
    signer,
    rpcUrl: `http://127.0.0.1:${PORT}`,
    network: "testnet",
    // A contract source can't run the pre-signing simulation; only used as the
    // envelope's classic source and never charged or signed by.
    simulationSourceAccount: SIM_SOURCE,
    allowHttp: true,
  });
}

const redirectAll = (sim: typeof simulation) => {
  sim.results![0]!.auth = sim.results![0]!.auth!.map((a) => redirectRecipient(a, ATTACKER));
  return sim;
};

describe("createX402Client — V-1 — a hostile RPC cannot get a signature over a redirected payment", () => {
  it("REFUSES to sign when the RPC redirects the recipient, and never reaches the signer", async () => {
    mutate = redirectAll;
    const { signer, calls } = trackingSigner();

    await expect(
      client(signer).createPayment(requirements, { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(AuthEntryMismatchError);

    // The assertion that a vulnerable version fails: it would have signed.
    expect(calls, "the signer was reached — the entry was signed before validation").toHaveLength(
      0,
    );
  }, 30_000);

  it("names the recipient mismatch, so the failure is diagnosable", async () => {
    mutate = redirectAll;
    const { signer } = trackingSigner();

    await expect(
      client(signer).createPayment(requirements, { maxAmount: 10_000_000n }),
    ).rejects.toThrow(/to \(recipient\) expected/);
    await expect(
      client(signer).createPayment(requirements, { maxAmount: 10_000_000n }),
    ).rejects.toThrow(ATTACKER);
  }, 30_000);

  it("CONTROL: the same harness signs happily when the RPC is honest", async () => {
    // Proves the refusal above is caused by the redirect, not by the stub being
    // unusable. Without this, the first test could pass for the wrong reason.
    mutate = (sim) => sim;
    const { signer, calls } = trackingSigner();

    // The signer is reached and asked to sign the honest entry. (The call fails
    // later — this stub doesn't model a post-signing re-simulation — reaching
    // the signer is the property under test.)
    await client(signer)
      .createPayment(requirements, { maxAmount: 10_000_000n })
      .catch(() => undefined);
    expect(calls.length, "the honest path never reached the signer").toBeGreaterThan(0);

    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(calls[0]!, "base64");
    const to = Address.fromScVal(
      signedEntry.rootInvocation().function().contractFn().args()[1]!,
    ).toString();
    expect(to).toBe(HONEST_PAYTO);
  }, 30_000);
});

beforeAll(
  () =>
    new Promise<void>((r) => {
      server = hostileRpc();
      server.listen(PORT, "127.0.0.1", () => r());
    }),
);
afterAll(() => new Promise<void>((r) => server.close(() => r())));
