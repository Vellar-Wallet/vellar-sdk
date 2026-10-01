/**
 * Issue #259: Review allowed-origin assumptions in connector.ts
 *
 * Provides origin checking for connector instances to ensure they only process
 * requests from allowed domains or localhost in development, explicitly
 * rejecting unexpected cross-origin invocations.
 */

export class ConnectorOriginGuard {
  private readonly allowedOrigins: Set<string>;
  private readonly allowLocalhost: boolean;

  constructor(origins: string[], allowLocalhost = false) {
    this.allowedOrigins = new Set(origins);
    this.allowLocalhost = allowLocalhost;
  }

  /**
   * Verifies an incoming origin against the configured policy.
   * Throws if the origin is not allowed.
   */
  public verifyOrigin(origin: string): void {
    if (!origin) {
      throw new Error("Origin is required for verification");
    }

    if (this.allowLocalhost) {
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return; // Localhost allowed
        }
      } catch {
        // Invalid origin URL format, fall through to set check
      }
    }

    if (!this.allowedOrigins.has(origin)) {
      throw new Error(`Origin not allowed: ${origin}`);
    }
  }
}
