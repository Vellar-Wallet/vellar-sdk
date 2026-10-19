// Issue #664 — the wallet session expiring while a payment is being signed.
//
// THE GAP. Neither x402 signer (src/x402-signer.ts) knows about the session.
// The only session check on the x402 path is in client.ts `resolveSigner`,
// which runs ONCE, before `createX402Client` simulates and signs. The passkey
// signer then awaits `webAuthn.sign()` — a user-facing prompt that can stay
// open for as long as the user leaves it. If the session ends (sign-out,
// `sessionStore.end()`, idle expiry, a switch to another wallet) during that
// window, the assertion still comes back, the signed entry is returned, and
// the client submits a payment bound to a session the SDK already considers
// gone.
//
// EXPECTED BEHAVIOUR FOR THE RACE (the decision this guard encodes):
//  - Before signing: no valid session for this signer's wallet ⇒ refuse, and
//    the underlying signer (the passkey prompt) is never invoked.
//  - After signing: re-check. If the session is no longer valid, or is no
//    longer the SAME session that was valid when signing began (ended and
//    re-started, or replaced by another wallet's), the signature is DISCARDED
//    — it never leaves signAuthEntry, so it is never submitted — and
//    SessionInvalidatedDuringSigningError is thrown.
//  - The in-flight authenticator ceremony itself cannot be cancelled from
//    here: WebAuthnAssertionSigner.sign() takes no AbortSignal. Discarding is
//    what guarantees the property; adding a signal would only make it faster.
//
// A signature produced by the authenticator but discarded here is harmless:
// it was never handed to the client, the facilitator, or the network, and the
// auth entry expires on-chain within the signature-expiration window anyway.

import type { SessionStore } from "../../src/session.js";
import type { WalletSession } from "../../src/types.js";
import type { SmartAccountX402Signer } from "../../src/x402-types.js";

/** Thrown when there is no valid session for the signer, before or during signing. */
export class SessionInvalidatedDuringSigningError extends Error {
  /** "before-signing": refused up front. "during-signing": a signature was discarded. */
  readonly phase: "before-signing" | "during-signing";

  constructor(phase: "before-signing" | "during-signing", reason: string) {
    super(
      phase === "before-signing"
        ? `x402: refusing to sign — ${reason}.`
        : `x402: the wallet session ended while the payment was being signed (${reason}); ` +
            "the signature was discarded and nothing was submitted.",
    );
    this.name = "SessionInvalidatedDuringSigningError";
    this.phase = phase;
  }
}

export interface SessionGuardOptions {
  /** The current session, or null when there is none. */
  getSession: () => WalletSession | null;
  /** Treat a session idle (since `lastActiveAt`) longer than this as expired. */
  maxIdleMs?: number;
  /** Clock, overridable for tests. */
  now?: () => Date;
}

/** Reads the session from a SessionStore; anything but "connected" counts as none. */
export function sessionFromStore(store: SessionStore): () => WalletSession | null {
  return () => {
    const { status, session } = store.getState();
    return status === "connected" ? session : null;
  };
}

/** Wrap an x402 signer so it never yields a signature for an invalid session. */
export function withSessionGuard(
  signer: SmartAccountX402Signer,
  options: SessionGuardOptions,
): SmartAccountX402Signer {
  const now = options.now ?? (() => new Date());

  /** Why `session` can't be used for this signer, or null when it can. */
  function invalidReason(session: WalletSession | null): string | null {
    if (!session) return "no wallet session is active";
    if (!session.connected) return "the wallet session is disconnected";
    if (session.accountId !== signer.address) {
      return `the active session is for ${session.accountId}, not ${signer.address}`;
    }
    if (options.maxIdleMs !== undefined) {
      const idle = now().getTime() - Date.parse(session.lastActiveAt);
      if (!(idle <= options.maxIdleMs)) return "the wallet session expired (idle)";
    }
    return null;
  }

  return {
    address: signer.address,
    async signAuthEntry(entryXdr, opts) {
      const before = options.getSession();
      const refused = invalidReason(before);
      if (refused) throw new SessionInvalidatedDuringSigningError("before-signing", refused);

      const signed = await signer.signAuthEntry(entryXdr, opts);

      const after = options.getSession();
      const stale = invalidReason(after);
      if (stale) throw new SessionInvalidatedDuringSigningError("during-signing", stale);
      // Same wallet but a NEW session (signed out and back in mid-prompt) is
      // still not the session the user approved this payment under.
      if (after!.createdAt !== before!.createdAt) {
        throw new SessionInvalidatedDuringSigningError(
          "during-signing",
          "the session was replaced by a new one",
        );
      }
      return signed;
    },
  };
}
