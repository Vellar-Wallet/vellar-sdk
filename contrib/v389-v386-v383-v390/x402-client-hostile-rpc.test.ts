// Issue #383 — a hostile-RPC proof for the PRIMARY x402-client path.
//
// packages/mcp-x402-payer/test/hostile-rpc.test.ts already proves V-1 for the
// MCP agent payer's own scheme client (`createSmartAccountScheme`). That
// client is a separate implementation living in a different package.
// `src/x402-client.ts` — which backs `wallet.x402.fetch`, the path
// vellar-dapp depends on — has no equivalent black-box test: only unit
// coverage of `assertAuthEntryInvocation` in isolation, plus evidence from the
// original fix commit diff.
//
// This drives the REAL, unmodified `createX402Client` (imported straight from
// `src/`, nothing patched) against a stub Soroban RPC that replays a real
// captured testnet `simulateTransaction` response with only the recipient
// mutated — so the auth entry is genuinely well-formed and correctly
// credentialed to the wallet. The only thing changed is the RECIPIENT inside
// the invocation. A unit assertion on the comparison function would not do:
// it would pass against a vulnerable version that never called it. The
// assertion that matters is that the SIGNER IS NEVER REACHED.
//
// WHY THIS LIVES IN contrib/ AND MOCKS `rpc.Server.prototype` RATHER THAN
// RUNNING A REAL LOCAL HTTP SERVER (as the MCP-payer test does): contributor
// PRs may only touch files inside `contrib/` (see CONTRIBUTING.md), so this
// test cannot add the `allowHttp` escape hatch `createX402Client` would need
// to talk to a plaintext `http://127.0.0.1` stub the way
// `smart-account-scheme.ts` already does for its own hostile-RPC test.
// Spying on `rpc.Server.prototype` sidesteps that: `new rpc.Server(...)` is
// constructed with a real `https://` URL (satisfying its own protocol check),
// and every method that would otherwise leave the process is mocked, so
// nothing is patched in `src/` and no plaintext RPC is ever contacted. See
// this folder's README.md for the (much smaller) actual proposed change to
// `src/x402-client.ts` if a maintainer prefers the local-server style instead.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthEntryMismatchError } from "../../src/x402-auth-entry.js";
import { createX402Client } from "../../src/x402-client.js";
import type { PaymentRequirements, SmartAccountX402Signer } from "../../src/x402-types.js";

// Captured from live testnet for packages/mcp-x402-payer's own hostile-RPC
// proof — reused verbatim rather than re-recording, so both proofs are
// checked against the identical real `simulateTransaction` response.
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

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const HONEST_PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const ATTACKER = "GB74DDOZVF4SX3SEB2HNXJTKDBEKI4PH7N6GUWAFLG76XJBX27AOW2YB";
const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Array<{
  method: string;
  response: { result: Record<string, unknown> };
}>;

const rawSimulation = fixture.find((e) => e.method === "simulateTransaction")!.response
  .result as { results?: Array<{ auth?: string[] }>; [k: string]: unknown };
const rawLedger = fixture.find((e) => e.method === "getLatestLedger")!.response.result as {
  id: string;
  sequence: number;
  protocolVersion: number;
};

/** Rewrite the recipient inside a real auth entry, leaving everything else intact. */
function redirectRecipient(authXdr: string, to: string): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(authXdr, "base64");
  const call = entry.rootInvocation().function().contractFn();
  const args = call.args();
  args[1] = nativeToScVal(to, { type: "address" });
  call.args(args);
  return entry.toXDR("base64");
}

const redirectAll = (raw: typeof rawSimulation) => {
  const clone = structuredClone(raw);
  clone.results![0]!.auth = clone.results![0]!.auth!.map((a) => redirectRecipient(a, ATTACKER));
  return clone;
};

/** Swapped per test. */
let mutate: (raw: typeof rawSimulation) => typeof rawSimulation = (raw) => raw;

beforeEach(() => {
  mutate = (raw) => raw;
  // `new rpc.Server(deps.rpcUrl)` inside createX402Client only needs to pass
  // its own protocol check — a real https URL does that with no network call
  // yet made. Every method that WOULD touch the network is mocked below, so
  // this is never actually dialed.
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockImplementation(async () => rawLedger as never);
  vi.spyOn(rpc.Server.prototype, "getAccount").mockImplementation(
    async (address: string) => new Account(address, "1") as never,
  );
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation(
    async () => rpc.parseRawSimulation(mutate(structuredClone(rawSimulation))) as never,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

function client(signer: SmartAccountX402Signer) {
  return createX402Client({
    signer,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "testnet",
    simulationSourceAccount: SIM_SOURCE,
  });
}

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
  });

  it("names the recipient mismatch, so the failure is diagnosable", async () => {
    mutate = redirectAll;
    const { signer } = trackingSigner();

    await expect(
      client(signer).createPayment(requirements, { maxAmount: 10_000_000n }),
    ).rejects.toThrow(/to \(recipient\) expected/);
    await expect(
      client(signer).createPayment(requirements, { maxAmount: 10_000_000n }),
    ).rejects.toThrow(ATTACKER);
  });

  it("CONTROL: the same harness signs happily when the RPC is honest", async () => {
    // Proves the refusal above is caused by the redirect, not by the stub
    // being unusable. Without this, the first test could pass for the wrong
    // reason.
    mutate = (raw) => raw;
    const { signer, calls } = trackingSigner();

    // The signer is reached and asked to sign the honest entry. (The call
    // fails later at re-simulation, which this stub does not model — reaching
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
  });
});
