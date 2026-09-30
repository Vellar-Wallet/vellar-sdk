/**
 * session-expiry.ts — Contributor reference implementation for #425.
 *
 * Adds client-side session key expiry validation before signing auth entries.
 * Prevents redundant RPC roundtrips and noisy failures on expired keys while
 * noting that on-chain smart account contracts remain the authoritative enforcement layer.
 */

export interface SignerClock {
  now(): number;
}

export const defaultSignerClock: SignerClock = {
  now: () => Date.now(),
};

export class SessionKeyExpiredError extends Error {
  readonly retryable = false as const;
  readonly expiresAt: number;
  readonly expiredByMs: number;

  constructor(expiresAt: number, expiredByMs: number) {
    super(
      `Session key expired at timestamp ${expiresAt} (${expiredByMs}ms ago). ` +
        `Refusing to sign auth entry; nothing was spent or submitted.`,
    );
    this.name = "SessionKeyExpiredError";
    this.expiresAt = expiresAt;
    this.expiredByMs = expiredByMs;
  }
}

export interface SessionExpiryOptions {
  expiresAt?: number | string | Date;
  warnThresholdMs?: number;
  onExpiringSoon?: (remainingMs: number) => void;
  clock?: SignerClock;
}

export function parseExpiryTimestamp(expiresAt?: number | string | Date): number | undefined {
  if (expiresAt === undefined) return undefined;
  if (typeof expiresAt === "number") return expiresAt;
  if (expiresAt instanceof Date) return expiresAt.getTime();
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid expiresAt timestamp or date string: "${expiresAt}"`);
  }
  return parsed;
}

export function checkSessionExpiry(options: SessionExpiryOptions): void {
  const expiryMs = parseExpiryTimestamp(options.expiresAt);
  if (expiryMs === undefined) return;

  const clock = options.clock ?? defaultSignerClock;
  const current = clock.now();

  if (current >= expiryMs) {
    throw new SessionKeyExpiredError(expiryMs, current - expiryMs);
  }

  const remainingMs = expiryMs - current;
  if (
    options.warnThresholdMs !== undefined &&
    remainingMs <= options.warnThresholdMs &&
    options.onExpiringSoon
  ) {
    options.onExpiringSoon(remainingMs);
  }
}

export function withSessionExpiryCheck<T extends { signAuthEntry(entry: unknown): Promise<unknown> }>(
  signer: T,
  options: SessionExpiryOptions,
): T {
  return {
    ...signer,
    signAuthEntry: async (entry: unknown) => {
      checkSessionExpiry(options);
      return signer.signAuthEntry(entry);
    },
  };
}
