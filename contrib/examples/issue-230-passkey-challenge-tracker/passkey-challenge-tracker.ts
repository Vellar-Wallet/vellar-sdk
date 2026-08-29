// Self-contained reference for issue #230: reject stale passkey assertions
// in passkeykit-connector.ts with typed errors. The real
// passkeykit-connector.ts delegates entirely to the opaque
// kit.sign()/kit.connectWallet() and never inspects a raw WebAuthn
// challenge itself — this is a standalone demonstration of the
// single-use/TTL tracking and typed error distinction that fix would add,
// for a caller that does have a challenge (e.g. one a backend mints for a
// step-up reauth before a sensitive action).
//
// Run with: npx tsx passkey-challenge-tracker.ts

/** Thrown when a challenge is older than the tracker's TTL. */
export class PasskeyAssertionExpiredError extends Error {
  constructor(
    public readonly challenge: string,
    public readonly issuedAt: Date,
    public readonly maxAgeMs: number,
  ) {
    super(
      `Passkey assertion challenge expired: issued at ${issuedAt.toISOString()}, ` +
        `max age ${maxAgeMs}ms`,
    );
    this.name = "PasskeyAssertionExpiredError";
  }
}

/** Thrown when a challenge was already consumed once — a genuine replay. */
export class PasskeyAssertionReplayedError extends Error {
  constructor(public readonly challenge: string) {
    super(`Passkey assertion challenge has already been used: ${challenge}`);
    this.name = "PasskeyAssertionReplayedError";
  }
}

/**
 * Tracks single-use passkey challenges, distinguishing a stale assertion
 * (too old — ask the user to retry) from a replayed one (already used — a
 * genuine replay attempt worth logging/alerting on) with a typed error for
 * each.
 */
export class ChallengeTracker {
  private readonly issuedAt = new Map<string, Date>();
  private readonly consumed = new Set<string>();
  private readonly maxAgeMs: number;
  private readonly now: () => Date;

  constructor(options: { maxAgeMs?: number; now?: () => Date } = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000; // 5 minutes
    this.now = options.now ?? (() => new Date());
  }

  /** Registers a freshly-issued challenge, timestamped at the current time. */
  register(challenge: string): void {
    this.pruneExpired();
    this.issuedAt.set(challenge, this.now());
    this.consumed.delete(challenge);
  }

  /**
   * Validates and single-use-consumes `challenge`. Throws
   * `PasskeyAssertionReplayedError` if already consumed,
   * `PasskeyAssertionExpiredError` if older than `maxAgeMs`, or a plain
   * `Error` if it was never registered at all.
   */
  consume(challenge: string): void {
    if (this.consumed.has(challenge)) {
      throw new PasskeyAssertionReplayedError(challenge);
    }
    const issuedAt = this.issuedAt.get(challenge);
    if (issuedAt === undefined) {
      throw new Error(`Unknown passkey assertion challenge: ${challenge}`);
    }
    const ageMs = this.now().getTime() - issuedAt.getTime();
    if (ageMs > this.maxAgeMs) {
      throw new PasskeyAssertionExpiredError(challenge, issuedAt, this.maxAgeMs);
    }
    this.consumed.add(challenge);
    this.issuedAt.delete(challenge);
  }

  /** Drops tracked challenges older than `maxAgeMs`, whether consumed or not. */
  private pruneExpired(): void {
    const cutoff = this.now().getTime() - this.maxAgeMs;
    for (const [challenge, issuedAt] of this.issuedAt) {
      if (issuedAt.getTime() < cutoff) {
        this.issuedAt.delete(challenge);
        this.consumed.delete(challenge);
      }
    }
  }
}

function main() {
  const tracker = new ChallengeTracker({ maxAgeMs: 5000 });

  console.log("Registering challenge 'abc123'...");
  tracker.register("abc123");

  console.log("Consuming it once...");
  tracker.consume("abc123");
  console.log("  ok — accepted.");

  console.log("Consuming it again (replay)...");
  try {
    tracker.consume("abc123");
  } catch (err) {
    console.log(`  rejected: ${err instanceof Error ? err.constructor.name : err}`);
  }

  console.log("\nRegistering challenge 'xyz789', then waiting past its TTL...");
  const now = { value: new Date() };
  const timedTracker = new ChallengeTracker({ maxAgeMs: 1000, now: () => now.value });
  timedTracker.register("xyz789");
  now.value = new Date(now.value.getTime() + 2000);
  try {
    timedTracker.consume("xyz789");
  } catch (err) {
    console.log(`  rejected: ${err instanceof Error ? err.constructor.name : err}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
