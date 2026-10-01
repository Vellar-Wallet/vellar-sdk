/**
 * Verification contract and standalone implementation of stdout diversion with secret redaction (#416).
 * Ensures that anything intercepted from stdout and forwarded to stderr is passed through redaction
 * to protect against credential leaks from third-party libraries (e.g. @x402/core calling console.log).
 */

export const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;
export const REDACTED = "[REDACTED]";

export class SecretRedactor {
  private readonly registered = new Set<string>();

  registerSecret(secret: string): void {
    if (secret) this.registered.add(secret);
  }

  redact(input: string): string {
    let out = input;
    for (const secret of this.registered) {
      if (!secret) continue;
      out = out.split(secret).join(REDACTED);
    }
    return out.replace(STELLAR_SECRET_PATTERN, REDACTED);
  }

  /**
   * Diverts stdout to stderr while redacting both registered secrets and
   * any unregistered Stellar secret seed patterns (#416).
   */
  divertStdoutToStderr(
    stdout: Pick<typeof process.stdout, "write"> = process.stdout,
    stderr: Pick<typeof process.stderr, "write"> = process.stderr,
  ): () => void {
    const original = stdout.write;
    (stdout as any).write = ((chunk: unknown, ...rest: unknown[]) => {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      stderr.write(this.redact(`[diverted-stdout] ${text}`));
      const cb = rest.find((a) => typeof a === "function") as undefined | (() => void);
      cb?.();
      return true;
    }) as typeof process.stdout.write;

    return () => {
      (stdout as any).write = original;
    };
  }
}
