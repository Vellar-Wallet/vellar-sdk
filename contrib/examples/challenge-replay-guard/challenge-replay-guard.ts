/**
 * Issue #260: Authorization Challenge Replay & Freshness Guard.
 */

export class ChallengeReplayGuard {
  private readonly seenNonces = new Map<string, number>();

  constructor(private readonly maxAgeMs = 5 * 60 * 1000) {}

  checkAndRecord(nonce: string, timestamp = Date.now()): void {
    const now = Date.now();
    this.cleanup(now);

    const age = now - timestamp;
    if (age > this.maxAgeMs || age < -30_000) {
      throw new Error(`Challenge expired (${age}ms old)`);
    }

    if (this.seenNonces.has(nonce)) {
      throw new Error(`Challenge nonce ${nonce} already used (replay attack)`);
    }

    this.seenNonces.set(nonce, now + this.maxAgeMs);
  }

  private cleanup(now: number): void {
    for (const [nonce, expiry] of this.seenNonces.entries()) {
      if (now > expiry) {
        this.seenNonces.delete(nonce);
      }
    }
  }
}
