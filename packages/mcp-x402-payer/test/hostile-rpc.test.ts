// V-1 end-to-end proof: a hostile RPC cannot obtain a signature over a payment
// we did not intend.
//
// This drives the REAL scheme client against a stub Soroban RPC. The stub
// replays a recording captured from live testnet
// (fixtures/soroban-rpc-recording.json), so the auth entry is genuinely
// well-formed and correctly credentialed to our wallet — it passes the
// credential-address check that already existed. The only thing changed is the
// RECIPIENT inside the invocation.
//
// Why not a unit assertion on the comparison function: that would pass against
// the vulnerable version, because the vulnerable version never called it. The
// assertion that matters is that the SIGNER IS NEVER REACHED.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { AuthEntryMismatchError } from "vellar-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmartAccountScheme } from "../src/smart-account-scheme.js";
import type { X402Requirement } from "../src/protocol.js";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const HONEST_PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const ATTACKER = "GB74DDOZVF4SX3SEB2HNXJTKDBEKI4PH7N6GUWAFLG76XJBX27AOW2YB";
const PORT = 4210;

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "soroban-rpc-recording.json"),
    "utf8",
  ),
) as Array<{ method: string; response: { result: Record<string, unknown> } }>;

const simulation = fixture.find((e) => e.method === "simulateTransaction")!.response.result as {
  results?: Array<{ auth?: string[] }>;
  [k: string]: unknown;
};
/** Replayed verbatim — the SDK XDR-decodes fields a hand-written stub gets wrong. */
const latestLedger = fixture.find((e) => e.method === "getLatestLedger")!.response.result;

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
    return reply({});
  });
}

/** A signer that records whether it was ever asked to sign. */
function trackingSigner() {
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

const requirements: X402Requirement = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "1000000",
  asset: USDC,
  payTo: HONEST_PAYTO,
  maxTimeoutSeconds: 120,
  extra: { areFeesSponsored: true },
};

let server: Server;

beforeAll(
  () =>
    new Promise<void>((r) => {
      server = hostileRpc();
      server.listen(PORT, "127.0.0.1", () => r());
    }),
);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const redirectAll = (sim: typeof simulation) => {
  sim.results![0]!.auth = sim.results![0]!.auth!.map((a) => redirectRecipient(a, ATTACKER));
  return sim;
};

function scheme(signer: { address: string; signAuthEntry: (x: string) => Promise<string> }) {
  return createSmartAccountScheme({
    signer,
    rpcUrl: `http://127.0.0.1:${PORT}`,
    allowHttp: true,
  });
}

describe("V-1 — a hostile RPC cannot get a signature over a redirected payment", () => {
  it("REFUSES to sign when the RPC redirects the recipient, and never reaches the signer", async () => {
    // Well-formed, still credentialed to WALLET — only the recipient moved.
    mutate = redirectAll;
    const { signer, calls } = trackingSigner();

    await expect(scheme(signer).createPaymentPayload(2, requirements)).rejects.toBeInstanceOf(
      AuthEntryMismatchError,
    );

    // The assertion that a vulnerable version fails: it would have signed.
    expect(calls, "the signer was reached — the entry was signed before validation").toHaveLength(0);
  }, 30_000);

  it("names the recipient mismatch, so the failure is diagnosable", async () => {
    mutate = redirectAll;
    const { signer } = trackingSigner();

    await expect(scheme(signer).createPaymentPayload(2, requirements)).rejects.toThrow(
      /to \(recipient\) expected/,
    );
    await expect(scheme(signer).createPaymentPayload(2, requirements)).rejects.toThrow(ATTACKER);
  }, 30_000);

  it("CONTROL: the same harness signs happily when the RPC is honest", async () => {
    // Proves the refusal above is caused by the redirect, not by the stub being
    // unusable. Without this, the first test could pass for the wrong reason.
    mutate = (sim) => sim;
    const { signer, calls } = trackingSigner();

    // The signer is reached and asked to sign the honest entry. (The call fails
    // later at re-simulation, which the stub does not model — reaching the
    // signer is the property under test.)
    await scheme(signer).createPaymentPayload(2, requirements).catch(() => undefined);
    expect(calls.length, "the honest path never reached the signer").toBeGreaterThan(0);

    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(calls[0]!, "base64");
    const to = Address.fromScVal(
      signedEntry.rootInvocation().function().contractFn().args()[1]!,
    ).toString();
    expect(to).toBe(HONEST_PAYTO);
  }, 30_000);
});
