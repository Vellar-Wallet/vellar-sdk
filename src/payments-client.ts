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
