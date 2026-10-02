/**
 * Issue #263: Rate limiting guard for passkeykit-connector authentication.
 */

export class RateLimitError extends Error {
  constructor(message = "Too many authentication attempts. Please try again later.") {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

export class PasskeyKitAuthRateLimiter {
  private attempts: number[] = [];
  
  constructor(private readonly config: RateLimitConfig = { maxAttempts: 5, windowMs: 60000 }) {}

  /**
   * Guards an authentication attempt. Throws RateLimitError if the limit is exceeded.
   * Otherwise records the attempt.
   */
  public guard(): void {
    const now = Date.now();
    // Prune attempts outside the window
    this.attempts = this.attempts.filter(timestamp => now - timestamp < this.config.windowMs);

    if (this.attempts.length >= this.config.maxAttempts) {
      throw new RateLimitError();
    }

    this.attempts.push(now);
  }
  
  /**
   * Resets the rate limiter for this instance (e.g., after successful auth).
   */
  public reset(): void {
    this.attempts = [];
  }
}
