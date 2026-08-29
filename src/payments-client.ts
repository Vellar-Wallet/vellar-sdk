import type { Network } from "./types";
import type { TokenInfo } from "./balances";
import { InvalidAmountError, type PaymentReview } from "./payments";
import { defaultSignedToXdr, type PasskeyKitLike } from "./passkeykit-connector";

// Payment flow against a passkey smart wallet: build the SAC transfer
// (SACClient simulates during build), have the user review, sign the wallet
// auth entries with the passkey, then submit through our backend (the relayer
// builds/fee-bumps the envelope server-side — the wallet holds no XLM for fees).
// Structural seams keep this unit-testable without passkey-kit or a network.

// The OpenZeppelin Relayer rejects transactions whose timeBounds.maxTime is
// more than 60s out (error 7002); sac-sdk's default timeout is 300s, so every
// transfer must set this explicitly. Verified against the live testnet relayer.
export const RELAYER_MAX_TIMEOUT_SECONDS = 30;

export interface TokenContractClientLike {
  transfer(
    args: { from: string; to: string; amount: bigint },
    options?: { timeoutInSeconds?: number },
  ): Promise<unknown>;
}

export interface SacClientLike {
  getSACClient(tokenContractId: string): TokenContractClientLike;
}

export interface PaymentSubmitBackend {
  /** POST /wallet/submit (idea.md §11) — resolves with the network tx hash. */
  submitTransaction(input: { signedXdr: string; network: Network }): Promise<{ hash: string }>;
}

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRecipientError";
  }
}

export interface PreparedPayment {
  review: PaymentReview;
  /**
   * Sign with the passkey and submit. Only ever call after explicit user
   * approval.
   *
   * Exactly-once guarantee (#240): when `preparePayment` was given a
   * `paymentId`, calling `confirm()` more than once for that same id — e.g.
   * a UI double-submit, or a consumer's own retry after a slow/uncertain
   * response — returns the SAME in-flight promise or cached result rather
   * than signing/submitting again. This is a same-instance, in-memory guard
   * (scoped to one `PaymentClient`, cleared on reload); it does not survive
   * a page refresh or protect against two independent `PaymentClient`
   * instances. It also does not by itself guarantee the underlying
   * transaction only lands on-chain once — that still depends on the
   * backend/relayer's own idempotency for a given signed XDR. See the
   * "Exactly-once guard" section of the payments doc for the full scope and
   * limits of this guarantee.
   */
  confirm(): Promise<{ hash: string }>;
}

export interface PaymentClient {
  preparePayment(input: {
    from: string;
    to: string;
    token: TokenInfo;
    amount: bigint;
    /**
     * Client-generated idempotency key for the exactly-once submission guard
     * (#240). Omit to opt out (each `confirm()` call submits independently,
     * the pre-#240 behavior). Reusing the same id for two DIFFERENT payments
     * (different amount/recipient/etc.) is a caller error — the guard keys
     * purely on the id, not on payment content, so it would incorrectly
     * short-circuit the second one to the first one's result.
     */
    paymentId?: string;
  }): Promise<PreparedPayment>;
}

export interface PaymentClientOptions {
  kit: Pick<PasskeyKitLike, "sign">;
  sac: SacClientLike;
  backend: PaymentSubmitBackend;
  network: Network;
  /** Address validation is required — payments must never reach signing with a bad recipient. */
  isValidAddress: (address: string) => boolean;
  signedToXdr?: (signed: unknown) => string;
}

export function createPaymentClient(options: PaymentClientOptions): PaymentClient {
  const signedToXdr = options.signedToXdr ?? defaultSignedToXdr;

  // Exactly-once submission guard (#240), keyed on the caller-supplied
  // paymentId. Tracks the IN-FLIGHT/settled confirm() promise per id, scoped
  // to this PaymentClient instance's lifetime (in-memory; not durable across
  // reloads — see PreparedPayment.confirm's doc comment for the full scope).
  //
  // A promise, not just a boolean "already submitted" flag, so a duplicate
  // confirm() call that arrives WHILE the first is still submitting shares
  // that same in-flight attempt instead of racing a second submission before
  // the first has even resolved — sharing the resolved/rejected outcome
  // either way once it settles.
  const submissionsByPaymentId = new Map<string, Promise<{ hash: string }>>();

  return {
    async preparePayment({ from, to, token, amount, paymentId }) {
      if (!options.isValidAddress(to)) {
        throw new InvalidRecipientError(`"${to}" is not a valid Stellar address`);
      }
      if (to === from) {
        throw new InvalidRecipientError("Recipient must differ from the sending account");
      }
      if (amount <= 0n) {
        throw new InvalidAmountError("Amount must be greater than zero");
      }

      // Builds AND simulates; simulation failures (e.g. insufficient balance)
      // surface here, before the user is ever asked to sign.
      const tx = await options.sac
        .getSACClient(token.contractId)
        .transfer({ from, to, amount }, { timeoutInSeconds: RELAYER_MAX_TIMEOUT_SECONDS });

      const review: PaymentReview = { from, to, token, amount, network: options.network };

      return {
        review,
        confirm() {
          if (paymentId !== undefined) {
            const existing = submissionsByPaymentId.get(paymentId);
            if (existing) return existing;
          }

          const submission = (async () => {
            const signed = (await options.kit.sign(tx)) ?? tx;
            return options.backend.submitTransaction({
              signedXdr: signedToXdr(signed),
              network: options.network,
            });
          })();

          if (paymentId !== undefined) {
            submissionsByPaymentId.set(paymentId, submission);
            // A REJECTED submission must not permanently block retries under
            // the same id — a failed attempt (e.g. transient relayer error)
            // is not "already submitted", and the whole point of an
            // idempotency key is to let the caller safely retry. Only a
            // resolved (successful) submission should keep the cached entry.
            submission.catch(() => {
              if (submissionsByPaymentId.get(paymentId) === submission) {
                submissionsByPaymentId.delete(paymentId);
              }
            });
          }

          return submission;
        },
      };
    },
  };
}
