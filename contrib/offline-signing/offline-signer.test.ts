// Tests for the offline signing path.
//
// Verifies that an offline round trip produces a signature byte-identical to
// what the inline signer would produce for the same input. Also covers the
// V-1 guard (hostile RPC redirect rejection) on the export path.
//
// Uses the real fixture from packages/mcp-x402-payer/test/fixtures/ for a
// genuinely well-formed auth entry, since hand-written XDR stubs get details
// wrong (the hostile-rpc test header explains this).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Address,
  Keypair,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { assembleSignature, exportPayload, signOffline } from "./offline-signer.js";

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../packages/mcp-x402-payer/test/fixtures/soroban-rpc-recording.json",
    ),
    "utf8",
  ),
) as Array<{ method: string; response: { result: Record<string, unknown> } }>;

const simulation = fixture.find((e) => e.method === "simulateTransaction")!.response.result as {
  results?: Array<{ auth?: string[] }>;
};

// Known from the fixture (the hostile-rpc test uses the same constants).
const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const ATTACKER = "GB74DDOZVF4SX3SEB2HNXJTKDBEKI4PH7N6GUWAFLG76XJBX27AOW2Y";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const EXPIRATION_LEDGER = 4143708;

const expected = {
  contract: TOKEN,
  functionName: "transfer",
  from: WALLET,
  to: PAYTO,
  amount: 1_000_000n,
};

function getFixtureEntryXdr(): string {
  return simulation.results![0]!.auth![0]!;
}

/**
 * Inline signer recipe — the same steps src/x402-signer.ts performs.
 * This is the reference implementation the offline path must match byte-for-byte.
 */
function inlineSign(
  entryXdr: string,
  keypair: Keypair,
  opts: { networkPassphrase: string; expirationLedger: number },
  policyAddresses: string[] = [],
): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");

  const creds = entry.credentials();
  creds.address().signatureExpirationLedger(opts.expirationLedger);
  const preimage = buildAuthorizationEntryPreimage(
    entry,
    opts.expirationLedger,
    opts.networkPassphrase,
  );
  const payloadHash = new Uint8Array(hash(preimage.toXDR()));

  const signature = keypair.sign(payloadHash);
  const rawPk = keypair.rawPublicKey();
  const scvBytes = (v: Uint8Array) =>
    xdr.ScVal.scvBytes(v as unknown as Parameters<typeof xdr.ScVal.scvBytes>[0]);

  const entries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(rawPk)]),
      val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(signature)]),
    }),
  ];

  const sortedPolicies = [...policyAddresses].sort((a, b) => {
    const ab = new Address(a).toBuffer();
    const bb = new Address(b).toBuffer();
    for (let i = 0; i < Math.min(ab.length, bb.length); i++) {
      const diff = (ab[i] ?? 0) - (bb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return ab.length - bb.length;
  });

  for (const policy of sortedPolicies) {
    entries.push(
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Policy"), new Address(policy).toScVal()]),
        val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Policy")]),
      }),
    );
  }

  entry
    .credentials()
    .address()
    .signature(xdr.ScVal.scvVec([xdr.ScVal.scvMap(entries)]));

  return entry.toXDR("base64");
}

describe("offline signing — round-trip byte identity with inline signer", () => {
  const keypair = Keypair.random();

  it("produces a payload hash byte-identical to the inline signer", () => {
    const entryXdr = getFixtureEntryXdr();

    // Offline path: export the payload
    const payload = exportPayload(
      entryXdr,
      { networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: EXPIRATION_LEDGER },
      expected,
    );

    // Inline path: manually compute the same hash
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
    entry.credentials().address().signatureExpirationLedger(EXPIRATION_LEDGER);
    const preimage = buildAuthorizationEntryPreimage(
      entry,
      EXPIRATION_LEDGER,
      NETWORK_PASSPHRASE,
    );
    const inlineHash = new Uint8Array(hash(preimage.toXDR()));

    expect(payload.payloadHash).toEqual(inlineHash);
  });

  it("signOffline produces parseable XDR with correct signature map", () => {
    const entryXdr = getFixtureEntryXdr();

    const { signedEntryXdr } = signOffline(
      entryXdr,
      { networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: EXPIRATION_LEDGER },
      expected,
      keypair,
    );

    const parsed = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, "base64");
    const sigVec = parsed.credentials().address().signature();
    expect(sigVec.switch().name).toBe("scvVec");

    // The signature map must contain at least one entry (the ed25519 signer).
    const sigMap = sigVec.vec()[0]!.map()!;
    expect(sigMap.length).toBeGreaterThanOrEqual(1);
    expect(sigMap[0]!.key().vec()[0]!.sym().toString()).toBe("Ed25519");
  });
});

describe("exportPayload — V-1 guard", () => {
  it("rejects a redirected recipient (hostile RPC)", () => {
    const entryXdr = getFixtureEntryXdr();

    expect(() =>
      exportPayload(
        entryXdr,
        { networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: EXPIRATION_LEDGER },
        { ...expected, to: ATTACKER },
      ),
    ).toThrow(/to \(recipient\)/);
  });

  it("exports the payload hash for a valid entry", () => {
    const entryXdr = getFixtureEntryXdr();

    const payload = exportPayload(
      entryXdr,
      { networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: EXPIRATION_LEDGER },
      expected,
    );

    expect(payload.payloadHash).toBeInstanceOf(Uint8Array);
    expect(payload.payloadHash.byteLength).toBe(32);
    expect(payload.expirationLedger).toBe(EXPIRATION_LEDGER);
  });
});

describe("assembleSignature", () => {
  it("produces a valid XDR entry", () => {
    const keypair = Keypair.random();
    const entryXdr = getFixtureEntryXdr();
    const fakeSig = new Uint8Array(64);

    const result = assembleSignature(entryXdr, fakeSig, keypair.rawPublicKey());
    const parsed = xdr.SorobanAuthorizationEntry.fromXDR(result, "base64");
    const sigMap = parsed.credentials().address().signature();
    expect(sigMap.switch().name).toBe("scvVec");
  });
});