// The single choke point for everything this server emits — tool responses and
// log lines alike. Three hazards live here, and they are handled in ONE place so
// they can be tested as properties rather than sampled per call site:
//
//   1. UNTRUSTED METADATA. Resource descriptions, mime types, service names and
//      facilitator error strings are written by whoever listed the resource.
//      The FENCE FORMAT ITSELF lives in `vellar-sdk/x402-untrusted` — one shared
//      implementation, also used by the facilitator's discovery MCP server,
//      because two copies of a security-relevant format drift and the drift is
//      invisible until something breaks out of a fence.
//
//      WHAT THE FENCE IS NOT: it is a CONVENTION, not enforcement. The nonce
//      makes the boundary unforgeable and the sanitiser removes dangerous
//      characters, but neither makes a model OBEY the instruction to treat the
//      block as data. That is a property of the model and is unverified here.
//      What actually bounds damage is the spend limits — above all the
//      chain-enforced budget.
//
//   2. SECRET LEAKAGE. Nothing that leaves this process is emitted without
//      passing through `redact()`. That is why the fence is wrapped here rather
//      than imported straight into callers: the shared module knows nothing
//      about our key material.
//
//   3. STDOUT CORRUPTION. On a stdio transport, stdout IS the JSON-RPC channel.
//      Any diagnostic written there desynchronises the protocol and the agent
//      sees a transport error rather than a payment error. Every log line here
//      goes to stderr. (Enforced by test/stdout-discipline.test.ts, which fails
//      if any src file calls console.* or touches process.stdout.)

import {
  renderUntrusted as fenceUntrusted,
  sanitizeMetadata as sanitizeMetadataText,
  type SanitizeOptions,
} from "vellar-sdk/x402-untrusted";

export { sanitizeUntrusted, terminatorOf, type SanitizeOptions } from "vellar-sdk/x402-untrusted";

/**
 * Any Stellar ed25519 secret seed shape, not just the one we hold.
 *
 * Belt and braces alongside the exact-match registry below: if key material is
 * ever re-derived, re-encoded, or read from somewhere we did not register, this
 * still catches it. `S` + 55 base32 chars is unambiguous — public keys are `G…`
 * and contract ids are `C…`.
 */
const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;

const REDACTED = "[REDACTED]";

/** Exact strings that must never appear in output. Registered once at startup. */
const registeredSecrets = new Set<string>();

/**
 * Register a secret for redaction. Call once, at startup, before anything can
 * be emitted. The value itself is never logged by this call.
 */
export function registerSecret(secret: string): void {
  if (secret) registeredSecrets.add(secret);
}

/** Test-only: drop registered secrets so cases don't leak into one another. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/** Replace any registered secret, or anything secret-shaped, with a placeholder. */
export function redact(text: string): string {
  let out = text;
  for (const secret of registeredSecrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out.replace(STELLAR_SECRET_PATTERN, REDACTED);
}

/**
 * Render server-supplied text as fenced untrusted data, redacting first.
 *
 * `singleLine` is for metadata; resource bodies keep their newlines, since
 * mangling the document the agent just paid for would defeat the point.
 */
export function renderUntrusted(
  label: string,
  text: string,
  opts: SanitizeOptions = {},
): string {
  return fenceUntrusted(label, redact(text), opts);
}

/** Sanitise a single line of server-supplied metadata, redacting first. */
export function sanitizeMetadata(text: string): string {
  return sanitizeMetadataText(redact(text));
}

export interface Truncated {
  text: string;
  truncated: boolean;
  /** Byte length of the ORIGINAL body, before any truncation. */
  originalBytes: number;
}

/**
 * Truncate UTF-8 bytes to `maxBytes` without emitting a broken code point, and
 * say so in-band when it happens.
 *
 * Silent truncation is the failure mode to avoid: an agent that cannot tell it
 * received a partial document may act on it as if it were complete.
 */
export function truncateUtf8(bytes: Uint8Array, maxBytes: number): Truncated {
  const originalBytes = bytes.byteLength;
  if (originalBytes <= maxBytes) {
    return { text: new TextDecoder().decode(bytes), truncated: false, originalBytes };
  }

  // A cut mid-sequence decodes to U+FFFD; drop those trailing replacements so we
  // never hand back a mangled final character.
  const decoded = new TextDecoder().decode(bytes.subarray(0, maxBytes));
  const text = decoded.replace(/�+$/, "");

  return {
    text: `${text}\n\n[TRUNCATED: showing ${maxBytes} of ${originalBytes} bytes]`,
    truncated: true,
    originalBytes,
  };
}

/**
 * Format an error for output: name and message only, redacted, never a stack.
 *
 * Stack frames can carry argument values, and library errors are verbose enough
 * to quote their inputs — so nothing but the shape of the failure gets out.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const message = redact(err.message);
    return err.name && err.name !== "Error" ? `${err.name}: ${message}` : message;
  }
  return redact(typeof err === "string" ? err : JSON.stringify(err) ?? String(err));
}

// ── stderr logging ───────────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error";

/**
 * Redirect anything written to stdout into stderr, for the process lifetime.
 *
 * Security audit V-4. stdout IS the MCP JSON-RPC channel, and our own code is
 * disciplined about that — but our DEPENDENCIES are not. `@x402/core` calls
 * `console.log` unguarded on the payment-response path
 * (`chunk-3LURPWBI.mjs:367`, reached from `:451`/`:500`), and whether it fires
 * depends on extension data the SELLER supplies. So a seller can desynchronise
 * the agent's transport, and the stdout-discipline test cannot catch it because
 * it only scans our own source.
 *
 * Call this AFTER the transport has captured its own handle: the returned
 * `restore` is for tests. Diverted output is prefixed so it is obvious in logs
 * that something bypassed the sanctioned path.
 */
export function divertStdoutToStderr(): () => void {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : String(chunk);
    process.stderr.write(redact(`[diverted-stdout] ${text}`));
    // Honour the callback so a caller awaiting the write does not hang.
    const cb = rest.find((a) => typeof a === "function") as undefined | (() => void);
    cb?.();
    return true;
  }) as typeof process.stdout.write;
  return () => {
    process.stdout.write = original;
  };
}

/** Structured log line → stderr. NEVER stdout: stdout is the MCP transport. */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = {
    level,
    msg: message,
    ...fields,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(line);
  } catch {
    serialized = JSON.stringify({ level, msg: message, fields: "[unserializable]" });
  }
  process.stderr.write(`${redact(serialized)}\n`);
}
