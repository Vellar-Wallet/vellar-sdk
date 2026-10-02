// Self-contained reference for issue #291: PII redaction for consumer-supplied
// logging hooks.
//
// The SDK never logs anything itself, but it does hand structured `details`
// objects to consumer-supplied hooks — `onDebugLog` on
// `createPasskeyKitConnector` (src/passkeykit-connector.ts) today — that a
// host typically pipes straight into their own logger or telemetry pipeline.
// Those details can carry fields that identify a specific user or wallet.
//
// This is a standalone, dependency-free demonstration of a redaction helper
// that a consumer wraps their own hook with, so those fields never reach the
// logger in plaintext.
//
// Run with: npx tsx pii-redaction-logging-hooks.ts

/**
 * Field names (case-insensitive, exact match) treated as sensitive. These are
 * the SDK-internal fields that identify a specific user, wallet, or
 * credential:
 *
 *  - `secretKey`, `secret`, `privateKey` — key material. The SDK never holds
 *    a wallet private key, but a consumer's hook can still receive these if
 *    the object they pass through carries a signer config.
 *  - `publicKey`, `previousPublicKey`, `newPublicKey` — ed25519 session-key
 *    public keys, as passed to `onDebugLog` by session-key rotation. Not
 *    secret, but a stable identifier tying a log line to one wallet's key.
 *  - `accountId`, `contractId` — the smart-account C-address. Directly
 *    identifies the wallet.
 *  - `keyId` — the WebAuthn credential id (`WalletSession.keyId`). Identifies
 *    the specific passkey / device.
 *  - `sessionId`, `serverSessionId` — server-side session record ids. Lets a
 *    log line be joined back to a specific user's backend session.
 *  - `signature` — auth-entry / WebAuthn assertion signature bytes.
 */
export const SENSITIVE_LOG_FIELDS: readonly string[] = [
  "secretKey",
  "secret",
  "privateKey",
  "publicKey",
  "previousPublicKey",
  "newPublicKey",
  "accountId",
  "contractId",
  "keyId",
  "sessionId",
  "serverSessionId",
  "signature",
];

const SENSITIVE_FIELD_SET = new Set(SENSITIVE_LOG_FIELDS.map((f) => f.toLowerCase()));

/** The string substituted for a redacted field's value. */
export const REDACTED = "[redacted]";

export interface RedactOptions {
  /** Additional field names to treat as sensitive, on top of
   * {@link SENSITIVE_LOG_FIELDS} — for consumer-specific fields (an email,
   * say) that your own payloads add before reaching the shared hook. */
  extraFields?: readonly string[];
  /** Maximum nesting depth to walk before leaving deeper values untouched.
   * Defaults to 6 — deep enough for any shape the SDK's hooks produce,
   * shallow enough to bound work on an adversarial object. */
  maxDepth?: number;
}

/**
 * Return a deep copy of `value` with every sensitive field (by name) replaced
 * with {@link REDACTED}. Matching is case-insensitive.
 *
 * Arrays are walked; non-plain values (functions, `Error`, `Date`, class
 * instances, XDR/ScVal-shaped objects) pass through as-is rather than being
 * spread into `{}` and losing their meaning — this is a redaction filter, not
 * a serializer. Circular references are replaced with `"[circular]"` rather
 * than looping forever. Does not mutate `value`.
 */
export function redactSensitiveFields<T>(value: T, options: RedactOptions = {}): T {
  const sensitive =
    options.extraFields && options.extraFields.length > 0
      ? new Set([...SENSITIVE_FIELD_SET, ...options.extraFields.map((f) => f.toLowerCase())])
      : SENSITIVE_FIELD_SET;
  const maxDepth = options.maxDepth ?? 6;
  return redact(value, sensitive, maxDepth, new Set()) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redact(
  value: unknown,
  sensitive: ReadonlySet<string>,
  depthRemaining: number,
  seen: Set<unknown>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depthRemaining <= 0) return value;
  if (seen.has(value)) return "[circular]";

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => redact(item, sensitive, depthRemaining - 1, seen));
  }

  // Only walk plain objects — an Error, Date, Map, ScVal/XDR instance, etc.
  // passes through untouched rather than being flattened.
  if (!isPlainObject(value)) return value;

  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (sensitive.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else {
      out[key] = redact(val, sensitive, depthRemaining - 1, seen);
    }
  }
  return out;
}

/** The shape of the SDK's consumer-supplied debug-log hook. */
export type DebugLogHook = (event: string, details: Record<string, unknown>) => void;

/**
 * Wrap a logging hook so every `details` object is redacted before it
 * reaches the underlying hook. This is the recommended way to apply the
 * helper: build the wrapper once and hand THAT to the SDK, so no call site
 * can forget to redact.
 */
export function withRedaction(hook: DebugLogHook, options: RedactOptions = {}): DebugLogHook {
  return (event, details) => hook(event, redactSensitiveFields(details, options));
}

function main() {
  // The kind of details object session-key rotation hands to `onDebugLog`.
  const rotationEvent = {
    previousPublicKey: "GOLDKEY0000000000000000000000000000000000000000000000000",
    newPublicKey: "GNEWKEY0000000000000000000000000000000000000000000000000",
    wallet: {
      accountId: "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW",
      keyId: "a-webauthn-credential-id",
      network: "testnet",
    },
    attempt: 1,
  };

  console.log("raw     :", JSON.stringify(rotationEvent));
  console.log("redacted:", JSON.stringify(redactSensitiveFields(rotationEvent)));

  // Wired the recommended way: the SDK is handed an already-redacting hook.
  const captured: string[] = [];
  const safeHook = withRedaction((event, details) => {
    captured.push(`${event} ${JSON.stringify(details)}`);
  });
  safeHook("session-key-rotated", rotationEvent);
  console.log("via hook:", captured[0]);

  // Non-sensitive fields survive; the raw key never appears anywhere.
  console.log("leaked raw key?:", captured[0]!.includes("GNEWKEY") ? "YES (bug)" : "no");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
