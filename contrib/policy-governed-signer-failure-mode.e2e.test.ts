// E2E proof for the policy-governed failure mode (issue #387): the REAL x402
// client (real RPC response parsing, real signing, real 402 loop) against a
// wallet whose `__check_auth` refuses the signature map, wrapped in the
// contrib reclassifier since contrib cannot modify src/.
//
// Why drive the whole client rather than unit-test the classifier: the
// valuable property is that MissingPolicyCosignerError reaches the CALLER of
// `wallet.x402.fetch()` from a genuine 402-with-PAYMENT-REQUIRED rejection,
// after genuine ed25519 signing over a real AssembledTransaction build — not
// merely that a regex matches a string.
//
// Hermetic by the suite's own rules (vitest.config.ts): no network. The RPC is
// stubbed at the TRANSPORT seam — `rpc.Server.prototype.simulateTransaction` /
// `getLatestLedger` — so the stub covers BOTH call sites (the direct
// `new rpc.Server` here and the one AssembledTransaction builds internally).
// Everything above the transport — request building, response PARSING,
// auth-entry assembly, signing, the 402 loop, header decoding — is the SDK's
// real code on `dev`, unmodified.
//
// The simulated auth entry is rebuilt from the SDK's own xdr builders so the
// fixture stays readable and re-verifiable: `transfer(USDC, WALLET → PAYTO,
// 1_000_000)` credentialed to the wallet — exactly what a policy-governed
// agent's payment looks like.

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  Address,
  buildAuthorizationEntryPreimage,
  hash,
  Keypair,
  nativeToScVal,
  rpc,
  SorobanDataBuilder,
  xdr,
} from "@stellar/stellar-sdk";
// NOTE: imported from its module, NOT `../src/index.js` — index re-exports
// `./x402-signer`, whose JSDoc is merge-corrupted on `dev` and does not parse.
// The real client itself (guards, types, request-auth) is clean on `dev`.
import { createX402Client } from "../src/x402-client.js";
import type { SmartAccountX402Signer } from "../src/x402-types.js";
import { requirements, response402 } from "../src/x402-test-fixtures.js";
import {
  MissingPolicyCosignerError,
  withMissingPolicyCosignerClassification,
} from "./policy-governed-signer-failure-mode.js";

// ── chain constants (a live testnet payment shape) ───────────────────────────

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
const LATEST_LEDGER = 4_143_708;

// ── fixture builders (deterministic; no captured-blob drift) ─────────────────

const zeros = new Uint8Array(32);
/** stellar-sdk's hash-accepting parameters declare Node `Buffer`; the SDK compiles
 * without @types/node, so a runtime-identical Uint8Array needs this cast. */
const asBuf = zeros as unknown as Buffer;

/** A minimal LedgerHeader as an RPC `getLatestLedger` would return. */
function ledgerHeader(): xdr.LedgerHeader {
  return new xdr.LedgerHeader({
    ledgerVersion: 20,
    previousLedgerHash: xdr.Hash.fromXDR(asBuf),
    scpValue: new xdr.StellarValue({
      txSetHash: xdr.Hash.fromXDR(asBuf),
      closeTime: new xdr.Uint64("1786740044"), // TimePoint
      upgrades: [],
      ext: xdr.StellarValueExt.stellarValueBasic(),
    }),
    txSetResultHash: xdr.Hash.fromXDR(asBuf),
    bucketListHash: xdr.Hash.fromXDR(asBuf),
    ledgerSeq: LATEST_LEDGER,
    totalCoins: new xdr.Int64("0"),
    feePool: new xdr.Int64("0"),
    inflationSeq: 0,
    idPool: new xdr.Uint64(0),
    baseFee: 100,
    baseReserve: 5000,
    maxTxSetSize: 1000,
    skipList: [xdr.Hash.fromXDR(asBuf), xdr.Hash.fromXDR(asBuf), xdr.Hash.fromXDR(asBuf), xdr.Hash.fromXDR(asBuf)],
    ext: new xdr.LedgerHeaderExt(0),
  });
}

/** The `headerXdr` + `metadataXdr` pair the SDK's getLatestLedger parser needs. */
function latestLedgerFixture(): { headerXdr: string; metadataXdr: string } {
  const header = ledgerHeader();
  const meta = new xdr.LedgerCloseMeta(
    0,
    new xdr.LedgerCloseMetaV0({
      ledgerHeader: new xdr.LedgerHeaderHistoryEntry({
        hash: xdr.Hash.fromXDR(asBuf),
        header,
        ext: new xdr.LedgerHeaderHistoryEntryExt(0),
      }),
      txSet: new xdr.TransactionSet({ previousLedgerHash: xdr.Hash.fromXDR(asBuf), txes: [] }),
      txProcessing: [],
      upgradesProcessing: [],
      scpInfo: [],
    }),
  );
  return { headerXdr: header.toXDR("base64"), metadataXdr: meta.toXDR("base64") };
}

/** A funded G-account entry for the simulation source (getLedgerEntries).
 * Only the PUBLIC key is needed — the source account signs nothing. */
function simulationSourceAccountFixture(): { key: string; xdr: string } {
  const kp = Keypair.fromPublicKey(SIM_SOURCE);
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: kp.xdrAccountId() }),
  );
  const entry = new xdr.AccountEntry({
    accountId: kp.xdrAccountId(),
    balance: new xdr.Int64("1000000000"),
    seqNum: new xdr.Int64("0"),
    inflationDest: null,
    numSubEntries: 0,
    flags: 0,
    homeDomain: "",
    thresholds: new Uint8Array([1, 0, 0, 0]) as unknown as Buffer,
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
  // The union type has no public constructor in the typings — use the
  // `account` static factory (same wire bytes).
  const value = xdr.LedgerEntryData.account(entry);
  return { key: key.toXDR("base64"), xdr: value.toXDR("base64") };
}

/** The unsigned auth entry a real transfer simulation produces. */
function transferAuthEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: new xdr.Int64("1"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(USDC).toScAddress(),
          functionName: "transfer",
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(1_000_000n, { type: "i128" }),
          ],
        }),
      ),
      subInvocations: [],
    }),
  });
}

/** transactionData (SorobanTransactionData) carrying the entry's footprint. */
function simulationTransactionData(): string {
  return new SorobanDataBuilder()
    .setReadOnly([xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract: new Address(USDC).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }))])
    .setReadWrite([xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract: new Address(USDC).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyNonce(
        new xdr.ScNonceKey({ nonce: new xdr.Int64("1") }),
      ),
      durability: xdr.ContractDataDurability.temporary(),
    }))])
    .setResourceFee(133_417)
    .build()
    .toXDR("base64");
}

// The wallet's generic auth wrapper, with NO nested policy invocation — the
// shape a policy-governed key signing without its policies produces.
const WALLET_AUTH_110_REJECTION =
  'HostError: Error(Auth, InvalidAction) — failed account authentication with error: ' +
  'Error(Contract, #110) for contract CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW';

// The shape a POLICY REFUSAL produces: same #110, but the policy was invoked.
const POLICY_REFUSED_REJECTION = WALLET_AUTH_110_REJECTION +
  '\n[Failed Diagnostic Event] contract try_call failed, policy__, ' +
  '[CAFIATCE, [Ed25519, Bytes(89b1)], [transfer]]' +
  '\n[Failed Diagnostic Event] VM call trapped with HostError: Error(Contract, #1)';

// ── the transport stub ────────────────────────────────────────────────────────

let simulateError: string | undefined;

function stubRpcTransport(): void {
  const latest = latestLedgerFixture();
  const sourceAccount = simulationSourceAccountFixture();
  // The SDK's Server declares these as methods; a prototype spy intercepts both
  // the direct `new rpc.Server(...)` here and the one inside
  // AssembledTransaction, with the real response parsing still exercised.
  type LedgerKeyLike = { toXDR: (f: string) => string };
  type ServerMethods = {
    simulateTransaction: (tx: { toEnvelope: () => { toXDR: (f: string) => string } }) => Promise<unknown>;
    getLatestLedger: () => Promise<unknown>;
    /** Private but single chokepoint: getLedgerEntry/getLedgerEntries both
     * funnel through it, so one stub covers account reads and footprint reads.
     * getLedgerEntry passes a SINGLE LedgerKey; getLedgerEntries an array. */
    _getLedgerEntries: (keys: LedgerKeyLike | LedgerKeyLike[]) => Promise<unknown>;
  };
  const proto = rpc.Server.prototype as unknown as ServerMethods & object;

  vi.spyOn(proto, "simulateTransaction").mockImplementation(async () => {
    // Exercise the SDK's real XDR decoding by handing back raw base64 —
    // the same wire format a real RPC serves.
    return simulateError === undefined
      ? {
          transactionData: simulationTransactionData(),
          events: [],
          minResourceFee: "133417",
          results: [
            { auth: [transferAuthEntry().toXDR("base64")], xdr: "AAAAAQ==" },
          ],
          stateChanges: [],
          latestLedger: LATEST_LEDGER,
        }
      : { error: simulateError, events: [], latestLedger: LATEST_LEDGER };
  });

  vi.spyOn(proto, "getLatestLedger").mockImplementation(async () => ({
    id: "stub",
    protocolVersion: 27,
    sequence: LATEST_LEDGER,
    closeTime: "1786740044",
    ...latest,
  }));

  vi.spyOn(proto, "_getLedgerEntries").mockImplementation(async (arg) => {
    // RAW wire shape: the real getLedgerEntry/getLedgerEntries parsers run on
    // it. getLedgerEntry passes a SINGLE LedgerKey; getLedgerEntries an array.
    const requested = Array.isArray(arg)
      ? arg[0]?.toXDR("base64")
      : arg.toXDR("base64");
    return requested === sourceAccount.key
      ? { entries: [{ key: requested, xdr: sourceAccount.xdr, lastModifiedLedgerSeq: LATEST_LEDGER }], latestLedger: LATEST_LEDGER }
      : { entries: [], latestLedger: LATEST_LEDGER };
  });
}

/** Fetch stub: answers the initial request with a 402 challenge, the paid retry with the given rejection. */
function stubFacilitator(opts: { paidStatus: number; paidReason: string }): { fetch: typeof fetch; calls: () => Request[] } {
  const calls: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(new Request(input instanceof Request ? input.url : String(input), init));
    const isRetry = calls.length > 1;
    if (!isRetry) return response402([requirements({ asset: USDC, payTo: PAYTO })]);
    return new Response(JSON.stringify({ error: opts.paidReason }), {
      status: opts.paidStatus,
      headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: opts.paidReason, accepts: [] }) },
    });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls: () => calls };
}

// browser-safe base64 (no Buffer — this module compiles with `types: []`)
function b64(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

// ── a local V1 session-key signer ────────────────────────────────────────
//
// Replicates `createSessionKeySigner`'s recipe with public SDK APIs (set
// expiration → buildAuthorizationEntryPreimage → hash → sign → the
// smart-wallet `Vec[Map[SignerKey → Signature]]` map), producing the same
// bytes. Needed because `dev`'s `src/x402-signer.ts` does not parse (merge
// corruption — see the README prerequisite note) and this test must run on
// unmodified `dev`. The signer is NOT the subject under test — the client's
// 402 loop, the real signing bytes in the envelope, and the classifier are.

const scvBytes = (value: Uint8Array): xdr.ScVal =>
  xdr.ScVal.scvBytes(value as unknown as Parameters<typeof xdr.ScVal.scvBytes>[0]);

function createContribSessionKeySigner(
  address: string,
  secretKey: string,
): SmartAccountX402Signer {
  const keypair = Keypair.fromSecret(secretKey);
  const rawPk = keypair.rawPublicKey();
  return {
    address,
    async signAuthEntry(entryXdr, { networkPassphrase, expirationLedger }) {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
      const creds = entry.credentials();
      creds.address().signatureExpirationLedger(expirationLedger);
      const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, networkPassphrase);
      const payload = hash(preimage.toXDR());
      const signature = keypair.sign(payload);
      creds
        .address()
        .signature(
          xdr.ScVal.scvVec([
            xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(rawPk)]),
                val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(signature)]),
              }),
            ]),
          ]),
        );
      return entry.toXDR("base64");
    },
  };
}

// ── the tests ────────────────────────────────────────────────────────────────

describe("x402 client — wallet rejects the signature map (issue #387)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    simulateError = undefined;
  });
  beforeEach(() => stubRpcTransport());

  function client(fetchImpl: typeof fetch) {
    const sessionKp = Keypair.random();
    return createX402Client({
      signer: createContribSessionKeySigner(WALLET, sessionKp.secret()),
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
    });
  }

  it("surfaces MissingPolicyCosignerError — the real client, real signing, wallet refuses #110", async () => {
    const facilitator = stubFacilitator({ paidStatus: 402, paidReason: WALLET_AUTH_110_REJECTION });

    await expect(
      withMissingPolicyCosignerClassification(() =>
        client(facilitator.fetch).fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
      ),
    ).rejects.toBeInstanceOf(MissingPolicyCosignerError);

    // The payment was REALLY signed before the rejection: the signed envelope
    // rides in the PAYMENT-SIGNATURE header of the paid retry (the first
    // simulate's envelope is pre-signing by design, so it proves nothing).
    expect(facilitator.calls()).toHaveLength(2);
    const sigHeader = facilitator.calls()[1]!.headers.get("PAYMENT-SIGNATURE");
    expect(sigHeader).toBeDefined();
    const payload = JSON.parse(atob(sigHeader!)) as { payload: { transaction: string } };
    const envelope = xdr.TransactionEnvelope.fromXDR(payload.payload.transaction, "base64");
    const op = envelope.v1().tx().operations()[0]!;
    expect(op.body().switch().name).toBe("invokeHostFunction");
    const auths = op.body().invokeHostFunctionOp().auth();
    expect(auths.length).toBeGreaterThan(0);
    const map = auths[0]!
      .credentials()
      .address()
      .signature()
      .vec()![0]!
      .map()!;
    expect(map).toHaveLength(1); // ed25519 only — the missing-co-signer config
    expect(map[0]!.key().vec()![0]!.sym().toString()).toBe("Ed25519");
    expect(map[0]!.val().vec()![1]!.bytes()).toHaveLength(64); // a real ed25519 sig
  }, 30_000);

  it("names the fix and preserves the raw diagnostics", async () => {
    const facilitator = stubFacilitator({ paidStatus: 402, paidReason: WALLET_AUTH_110_REJECTION });

    const err = await withMissingPolicyCosignerClassification(() =>
      client(facilitator.fetch).fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).then(
      () => {
        throw new Error("expected the fetch to reject");
      },
      (e: unknown) => e as MissingPolicyCosignerError,
    );

    expect(err.message).toContain("this signer may require policies to be configured");
    expect(err.message).toMatch(/createSessionKeySigner/);
    expect(err.message).toContain(WALLET_AUTH_110_REJECTION);
    expect(err.name).toBe("MissingPolicyCosignerError");
    // The payment was rejected on the PAID retry — nothing was signed twice.
    expect(facilitator.calls()).toHaveLength(2);
  }, 30_000);

  it("does NOT reclassify a policy refusal (same #110, nested policy__ call)", async () => {
    const facilitator = stubFacilitator({ paidStatus: 402, paidReason: POLICY_REFUSED_REJECTION });

    await expect(
      withMissingPolicyCosignerClassification(() =>
        client(facilitator.fetch).fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      return e instanceof Error && !(e instanceof MissingPolicyCosignerError);
    });
  }, 30_000);
});
