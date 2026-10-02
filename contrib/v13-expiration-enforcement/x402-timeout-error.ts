/**
 * The seller's maxTimeoutSeconds is too short for a payment to complete.
 *
 * Security audit V-13. Refused before signing: the window it allows is below
 * what a settlement has been measured to need, and signing anyway would produce
 * a signature that expires mid-flight and fails opaquely. Nothing was spent.
 */
export class UnworkableTimeoutError extends Error {
  constructor(
    readonly maxTimeoutSeconds: number,
    readonly ledgers: number,
  ) {
    super(
      `The resource server allows only ${maxTimeoutSeconds}s to settle, which is about ` +
        `${ledgers} ledgers — below the ~25s a settlement has been measured to need. ` +
        `Refusing before signing rather than producing a signature that expires mid-payment. ` +
        `Nothing was spent. This is the seller's configuration, not a fault in the payment.`,
    );
    this.name = "UnworkableTimeoutError";
  }
}

/**
 * Smallest signature window we will accept (security audit V-13).
 *
 * The measured worst sign-to-settled window is 12.0s; MIN_EXPIRATION_LEDGERS
 * (3 ≈ 15s) leaves only ~3s of headroom, so a seller advertising a very short
 * `maxTimeoutSeconds` gets a signature that can expire mid-settle. Nothing is
 * spent when that happens — the facilitator rejects at verify — but the caller
 * sees an opaque failure rather than "the seller's window was too short".
 *
 * We cannot fix it by signing for longer: the facilitator derives its own
 * `maxLedger` from the same `maxTimeoutSeconds` and rejects anything beyond it
 * as `expiration_too_far`. So the honest response is to refuse up front and say
 * why. 5 ledgers (~25s) is ~2x the measured worst case.
 */
export const MIN_VIABLE_EXPIRATION_LEDGERS = 5;
