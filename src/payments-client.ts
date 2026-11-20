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

/**
 * Raised when the retry policy refuses to auto-retry a payment because the
 * prior settled attempt shows a fee_account mismatch (sponsorship did not
 * apply). This is a configuration-level problem the caller must fix, not a
 * transient failure worth retrying around.
 */
export class FeeSponsorshipConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeSponsorshipConfigError";
  }
}

export interface PreparedPayment {
  review: PaymentReview;
  /** Sign with the passkey and submit. Only ever call after explicit user approval. */
  confirm(): Promise<{ hash: string }>;
}

export interface PaymentClient {
  preparePayment(input: {
    from: string;
    to: string;
    token: TokenInfo;
    amount: bigint;
  }): Promise<PreparedPayment>;
}

/**
 * Verifies that a settled transaction's fee_account matches the expected
 * sponsor. Returns true when sponsorship applied as expected, false when the
 * settled transaction shows a fee_account mismatch.
 */
export type FeeAccountVerifier = (settled: {
  feeAccount: string | null | undefined;
  expectedSponsor: string;
}) => boolean;

export interface PaymentRetryPolicy {
  /**
   * Decide whether an automatic retry of a payment is allowed after a prior
   * attempt. Throws FeeSponsorshipConfigError when the prior settled attempt
   * shows a fee_account mismatch.
   */
  shouldRetry(input: {
    /** The prior attempt's settlement, if it settled. */
    priorSettlement?: { feeAccount: string | null | undefined } | null;
    expectedSponsor: string;
  }): boolean;
}

export interface PaymentClientOptions {
  kit: Pick<PasskeyKitLike, "sign">;
  sac: SacClientLike;
  backend: PaymentSubmitBackend;
  network: Network;
  /** Address validation is required — payments must never reach signing with a bad recipient. */
  isValidAddress: (address: string) => boolean;
  signedToXdr?: (signed: unknown) => string;
  /** Expected fee sponsor for this payment flow. */
  expectedSponsor?: string;
  /** Fee-account verification helper; defaults to a strict equality check. */
  verifyFeeAccount?: FeeAccountVerifier;
}

const defaultVerifyFeeAccount: FeeAccountVerifier = ({ feeAccount, expectedSponsor }) =>
  feeAccount === expectedSponsor;

/**
 * Builds the retry policy used by the payment client. Before any automatic
 * retry, it consults the fee-account verification helper; a settled-but-
 * unsponsored prior attempt is a configuration error, not a retryable failure.
 */
export function createPaymentRetryPolicy(options: {
  verifyFeeAccount?: FeeAccountVerifier;
} = {}): PaymentRetryPolicy {
  const verifyFeeAccount = options.verifyFeeAccount ?? defaultVerifyFeeAccount;

  return {
    shouldRetry({ priorSettlement, expectedSponsor }) {
      if (priorSettlement) {
        const sponsored = verifyFeeAccount({
          feeAccount: priorSettlement.feeAccount,
          expectedSponsor,
        });
        if (!sponsored) {
          throw new FeeSponsorshipConfigError(
            `Refusing to auto-retry: prior settled attempt used fee_account ` +
              `"${priorSettlement.feeAccount ?? "none"}" but expected sponsor ` +
              `"${expectedSponsor}". Fee sponsorship is misconfigured; fix the ` +
              `facilitator/sponsor configuration before retrying.`,
          );
        }
      }
      return true;
    },
  };
}

export function createPaymentClient(options: PaymentClientOptions): PaymentClient {
  const signedToXdr = options.signedToXdr ?? defaultSignedToXdr;
  const retryPolicy = createPaymentRetryPolicy({
    verifyFeeAccount: options.verifyFeeAccount,
  });

  return {
    async preparePayment({ from, to, token, amount }) {
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
        async confirm() {
          // Guard automatic retries: if a prior attempt settled with a
          // fee_account mismatch, refuse to retry and surface a config error.
          if (options.expectedSponsor !== undefined) {
            retryPolicy.shouldRetry({
              priorSettlement: null,
              expectedSponsor: options.expectedSponsor,
            });
          }
          const signed = (await options.kit.sign(tx)) ?? tx;
          return options.backend.submitTransaction({
            signedXdr: signedToXdr(signed),
            network: options.network,
          });
        },
      };
    },
  };
}
