// Issue #666 — session-wide replay guard for nonces.
//
// Scope is deliberately GLOBAL per tracker, not per resource. A nonce is meant to
// be unique to one authorization, so seeing the same value on two different
// resources is itself the anomaly; a per-resource cache would treat the second
// sighting as fresh and miss exactly the cross-resource replay. Create one
// tracker per session and share it across every resource you pay for.
//
// See also the replay-window contract test tracked in #407.
// Integration: move into src/x402-guards.ts (it is pure, like everything there).

export interface NonceTracker {
  /** Record `nonce` for `resource`. Returns false if it was already seen anywhere. */
  claim(nonce: string, resource: string): boolean;
}

export function createNonceTracker(): NonceTracker {
  const seen = new Map<string, string>();
  return {
    claim(nonce, resource) {
      if (seen.has(nonce)) return false;
      seen.set(nonce, resource);
      return true;
    },
  };
}
