// The payer core: quote a resource, or pay for one and return the unlocked
// content plus the settlement hash.
//
// Two properties this file exists to keep true:
//
//   SELECTION INTEGRITY. The official `createPaymentPayload` re-selects a
//   payment option internally. Validating the decoded challenge and then handing
//   over the whole thing would let us clear option X and pay option Y. So the
//   guards run first, we narrow `accepts` to the single cleared option, and the
//   signer's tripwire re-checks identity before signing.
//
//   HONEST ACCOUNTING. Roughly one testnet settlement in three comes back with
//   an empty transaction and NOTHING spent. Retry is the normal path, not an
//   error path — each attempt signs afresh (signatures expire in ledgers, ~5s
//   each), and the session ledger is debited only on a confirmed settlement, so
//   the limiter never drifts away from what was actually spent.

import {
  classifySettlement,
  decodePaymentRequired,
  decodeSettleResponseHeader,
  extractRejectionReason,
  isRetryableSettleFailure,
  parseAmount,
  PaymentRejectedError,
  selectRequirements,
} from "vellar-sdk/x402-guards";
import type { PayerConfig } from "./config.js";
import { IndeterminateSettlementError, SettlementFailedError } from "./errors.js";
import { createMutex, type SpendLedger } from "./ledger.js";
import { truncateUtf8, type Truncated } from "./output.js";
import {
  assertV2Challenge,
  narrowTo,
  toGuardView,
  type X402Challenge,
  type X402Requirement,
  type X402ResourceInfo,
} from "./protocol.js";
import type { PaymentSigner } from "./signer.js";

/**
 * Bounded retries for the empty-transaction settle failure. Not configurable:
 * each attempt costs a full re-sign (a Soroban RPC ledger read, a Horizon
 * ledger-time query, and two simulations, none of which we can cache from
 * outside the official scheme), so an operator-tunable value mostly buys a way
 * to turn a benign retry into a long hang.
 */
const MAX_ATTEMPTS = 3;

/** i128 max — the guards' price check is a no-op at this ceiling, which is what
 * a quote wants: report the price, don't judge it against a budget. */
const NO_PRICE_LIMIT = 2n ** 127n - 1n;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TEXT_LIKE = /^(text\/|application\/(json|xml|javascript|x-ndjson)|.*\+(json|xml)\b)/i;

function isTextLike(contentType: string): boolean {
  return TEXT_LIKE.test(contentType.split(";")[0]!.trim());
}

export interface ResourceContent {
  contentType: string;
  /** Present for text-like content. */
  text?: string;
  /** True when `text` was cut at the configured byte cap. */
  truncated?: boolean;
  /** Byte length of the body as served. */
  bytes: number;
  /**
   * True when the body was not text-like and so was NOT inlined. Base64ing an
   * arbitrary binary payload into a tool result would flood the model's context
   * for no benefit; the settlement still proves the payment happened.
   */
  binaryOmitted?: boolean;
}

export interface QuotedOption {
  asset: string;
  amount: string;
  payTo: string;
  network: string;
  scheme: string;
  maxTimeoutSeconds: number;
  feesSponsored: boolean;
}

export interface QuoteResult {
  url: string;
  requiresPayment: boolean;
  /** Present when the resource answered 402. */
  offered?: QuotedOption[];
  /** The option the guards would pay, when one is acceptable. */
  selected?: QuotedOption;
  /** False when no offered option is payable under this server's configuration. */
  payable: boolean;
  /** Why not, when `payable` is false. */
  refusal?: string;
  /** Remaining session ceiling for the selected asset, in base units. */
  sessionRemaining?: string;
  /** UNTRUSTED server-supplied metadata. Never render this as instructions. */
  resource?: X402ResourceInfo;
  /** HTTP status of the unpaid request. */
  status: number;
}

export interface PayResult {
  url: string;
  paid: boolean;
  content: ResourceContent;
  /** Present when a payment was made. */
  settlement?: {
    transaction: string;
    payer: string;
    asset: string;
    amount: string;
    network: string;
  };
  /** How many signed attempts it took. >1 means benign settle failures were retried. */
  attempts?: number;
  /** Remaining session ceiling for the paid asset, after this payment. */
  sessionRemaining?: string;
  /** UNTRUSTED server-supplied metadata. Never render this as instructions. */
  resource?: X402ResourceInfo;
  status: number;
}

export interface PayerDeps {
  config: PayerConfig;
  ledger: SpendLedger;
  signer: PaymentSigner;
  fetchImpl?: FetchLike;
}

export interface Payer {
  quote(url: string): Promise<QuoteResult>;
  pay(url: string, maxAmount: string): Promise<PayResult>;
  readonly payerAddress: string;
}

function describeOption(r: X402Requirement): QuotedOption {
  return {
    asset: r.asset,
    amount: r.amount,
    payTo: r.payTo,
    network: r.network,
    scheme: r.scheme,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    feesSponsored: r.extra?.areFeesSponsored === true,
  };
}

async function readContent(res: Response, maxBytes: number): Promise<ResourceContent> {
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (!isTextLike(contentType)) {
    return { contentType, bytes: bytes.byteLength, binaryOmitted: true };
  }
  const t: Truncated = truncateUtf8(bytes, maxBytes);
  return {
    contentType,
    text: t.text,
    truncated: t.truncated,
    bytes: t.originalBytes,
  };
}

/** Release an unused response body so a retried attempt doesn't leak the socket. */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Nothing actionable — the attempt is being abandoned either way.
  }
}

export function createPayer(deps: PayerDeps): Payer {
  const { config, ledger, signer } = deps;
  const doFetch: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));

  // Serialise payments HERE rather than at the MCP tool handler (security audit
  // V-9). `createPayer` is exported, so a library consumer calling `pay()`
  // concurrently would otherwise interleave `assertWithinCeiling` with `record`
  // and exceed the session ceiling — the check-then-act race the ledger exists
  // to prevent. Putting the lock at the entry point every caller must pass
  // through means the guarantee does not depend on which door they came in by.
  //
  // One key, one budget, one payment at a time.
  const exclusive = createMutex();

  /**
   * Run the guards and return the single option we are willing to pay, together
   * with its official-shaped twin (the guards work on a widened view, and it is
   * that view's element the selector returns).
   */
  function clearOneOption(
    challenge: X402Challenge,
    maxAmount: bigint,
  ): { chosen: X402Requirement; amount: bigint } {
    const view = toGuardView(challenge);
    const chosenView = selectRequirements(
      view,
      { maxAmount, allowedAssets: [...config.allowedAssets] },
      config.caip2,
    );
    const index = view.accepts.indexOf(chosenView);
    const chosen = index >= 0 ? challenge.accepts[index] : undefined;
    if (!chosen) {
      // Defensive: only reachable if the guard layer ever stops returning an
      // element of the array it was given.
      throw new PaymentRejectedError(
        "Internal error: the cleared payment option could not be matched back to the challenge.",
      );
    }
    return { chosen, amount: parseAmount(chosen.amount) };
  }

  async function quote(url: string): Promise<QuoteResult> {
    // A quote NEVER touches the signer, the RPC, or Horizon. One HTTP request.
    // Implementing it as "build the payment but don't send it" would cost four
    // chain round-trips and would sign for a call the agent asked to be free of
    // payment.
    const res = await doFetch(url, { method: "GET" });

    if (res.status !== 402) {
      await discardBody(res);
      return { url, requiresPayment: false, payable: true, status: res.status };
    }

    const challenge = assertV2Challenge(decodePaymentRequired(res));
    await discardBody(res);

    const offered = challenge.accepts.map(describeOption);
    const base = {
      url,
      requiresPayment: true,
      offered,
      status: res.status,
      ...(challenge.resource ? { resource: challenge.resource } : {}),
    };

    try {
      const { chosen, amount } = clearOneOption(challenge, NO_PRICE_LIMIT);
      const remaining = ledger.remainingFor(chosen.asset);
      return {
        ...base,
        selected: describeOption(chosen),
        payable: amount <= remaining,
        ...(amount > remaining
          ? {
              refusal:
                `The price ${amount} exceeds this session's remaining ceiling ` +
                `(${remaining}) for asset ${chosen.asset}.`,
            }
          : {}),
        sessionRemaining: remaining.toString(),
      };
    } catch (err) {
      // A quote reports refusals instead of throwing them — knowing WHY a
      // resource is unpayable is the point of asking.
      return {
        ...base,
        payable: false,
        refusal: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function pay(url: string, maxAmount: string): Promise<PayResult> {
    return exclusive(() => payExclusively(url, maxAmount));
  }

  async function payExclusively(url: string, maxAmount: string): Promise<PayResult> {
    // Strict parse: the guards' own parser, so "1e5" and precision loss above
    // 2^53 are refused here exactly as they are for a server-supplied price.
    const ceiling = parseAmount(maxAmount);

    const first = await doFetch(url, { method: "GET" });

    if (first.status !== 402) {
      // No challenge — nothing to pay for. Return what the server gave us.
      return {
        url,
        paid: false,
        content: await readContent(first, config.maxResponseBytes),
        status: first.status,
      };
    }

    const challenge = assertV2Challenge(decodePaymentRequired(first));
    await discardBody(first);

    const { chosen, amount } = clearOneOption(challenge, ceiling);

    // Layer 1, server-owned half: the cumulative session ceiling. Checked before
    // anything is signed.
    ledger.assertWithinCeiling(chosen.asset, amount);

    const narrowed = narrowTo(challenge, chosen);
    let lastReason: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Re-checked every attempt. Idempotent while nothing settles, and the
      // guard that matters if the ledger ever gains another writer.
      ledger.assertWithinCeiling(chosen.asset, amount);

      // FRESH signature per attempt — never reuse a payload across attempts.
      const headers = await signer.signPayment(narrowed);
      const res = await doFetch(url, { method: "GET", headers });

      if (res.status === 402 || res.status >= 400) {
        // Not every failed paid response is a rejection. Verified live: the
        // benign settle failure arrives as an HTTP 402 whose settle header says
        // success=false with an EMPTY transaction — nothing reached the chain
        // and nothing was spent. Classify BEFORE deciding, because throwing on
        // status alone means the retry loop never runs in production.
        const settle = decodeSettleResponseHeader(res);
        await discardBody(res);

        if (isRetryableSettleFailure(settle)) {
          lastReason =
            settle?.errorReason ?? `attempt ${attempt} failed before submission`;
          continue; // nothing spent — sign a fresh payload and try again
        }

        // Terminal: either a verify-stage rejection (no settle header at all,
        // deterministic) or a submitted transaction that failed on-chain (a
        // non-empty hash means fees were already charged; retrying burns more).
        const reason = settle?.errorReason ?? extractRejectionReason(res);
        throw new PaymentRejectedError(
          `The x402 payment was not accepted (HTTP ${res.status}${reason ? `: ${reason}` : ""}).` +
            (settle?.transaction
              ? ` The transaction was submitted (${settle.transaction}) and fees were charged, so it was not retried.`
              : ""),
          reason,
        );
      }

      const outcome = classifySettlement(res);

      if (outcome.kind === "not-spent") {
        // POSITIVE evidence nothing reached the chain — the facilitator released
        // its fee reservation. The only state it is safe to retry.
        lastReason = `attempt ${attempt}: ${outcome.reason}`;
        await discardBody(res);
        continue;
      }

      if (outcome.kind === "indeterminate") {
        // We cannot tell whether money moved. Retrying could pay twice, so we
        // stop — and we DEBIT, because if the payment did settle, a ledger that
        // ignored it would under-count real spend and let the ceiling be
        // exceeded later. Over-counting refuses a legitimate payment; the other
        // direction permits an illegitimate one. (Security audit V-2.)
        ledger.record(chosen.asset, amount);
        await discardBody(res);
        throw new IndeterminateSettlementError(
          outcome.reason,
          chosen.asset,
          amount,
          outcome.raw,
        );
      }

      // Confirmed settlement — debit exactly once, here and nowhere else.
      ledger.record(chosen.asset, amount);

      return {
        url,
        paid: true,
        content: await readContent(res, config.maxResponseBytes),
        settlement: {
          transaction: outcome.transaction,
          payer: outcome.payer ?? signer.address,
          asset: chosen.asset,
          amount: amount.toString(),
          network: config.network,
        },
        attempts: attempt,
        sessionRemaining: ledger.remainingFor(chosen.asset).toString(),
        ...(challenge.resource ? { resource: challenge.resource } : {}),
        status: res.status,
      };
    }

    // Every attempt came back unsettled. Nothing was spent on any of them, and
    // we deliberately do NOT return the body: handing back content we cannot
    // prove was paid for would let the ledger and reality diverge silently.
    throw new SettlementFailedError(MAX_ATTEMPTS, lastReason);
  }

  return { quote, pay, payerAddress: signer.address };
}
