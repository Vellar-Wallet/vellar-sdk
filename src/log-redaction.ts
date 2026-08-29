// PII / sensitive-field redaction for consumer-supplied logging hooks (#291).
//
// This SDK never logs anything itself (no logging library dependency), but it
// does hand structured `details` objects to consumer-supplied hooks —
// `onDebugLog` on `createPasskeyKitConnector` today — that a host typically
// pipes straight into their own logger/telemetry pipeline. Those details can
// carry fields that identify a specific user or wallet: an ed25519 session-key
// public key, a smart-account contract id, a server-side session id, or a
// WebAuthn credential id. None of these are "secrets" in the sense of a
// private key (this SDK never has one to log), but they are stable,
// wallet-linkable identifiers — exactly the shape of field a downstream log
// aggregator, support ticket export, or analytics sink should not retain in
// plaintext.
//
// This module does NOT change what any SDK code passes to a hook — that
// would be a silent, surprising behavior change for consumers who already
// rely on seeing real values (e.g. in tests, or their own already-redacting
// pipeline). Instead it's an opt-in helper: wrap your `onDebugLog` (or any
// other hook fed SDK-internal objects) with `redactSensitiveFields` yourself.
//
//   const vellar = createVellarWallet({
//     ...,
//     onDebugLog: (event, details) => myLogger.debug(event, redactSensitiveFields(details)),
//   });

/**
 * Field names (case-insensitive, exact match) treated as sensitive by
 * {@link redactSensitiveFields}. Covers every field this SDK's own hooks and
 * public types are known to carry that identifies a specific user, wallet, or
 * credential:
 *
 *  - `secretKey`, `secret`, `privateKey` — key material. This SDK never holds
 *    a wallet private key, but a consumer's own logging hook can receive
 *    these if the object passed through also carries a signer config (e.g.
 *    a caller logging `{ event, config }` rather than just the hook's
 *    `details` parameter).
 *  - `publicKey`, `previousPublicKey`, `newPublicKey` — ed25519 session-key
 *    public keys, as passed to `onDebugLog` by session-key rotation
 *    (`src/passkeykit-connector.ts`). Not secret, but a stable identifier
 *    tying a log line to one wallet's agent key.
 *  - `accountId`, `contractId` — the smart-account C-address. Directly
 *    identifies the wallet.
 *  - `keyId` — the WebAuthn credential id (`WalletSession.keyId`). Identifies
 *    the specific passkey/device.
 *  - `sessionId`, `serverSessionId` — server-side session record ids
 *    (`WalletSession.serverSessionId`, `WalletBackend` responses). Lets a
 *    log line be joined back to a specific user's backend session.
 *  - `signature` — auth-entry / WebAuthn assertion signature bytes. Not
 *    reversible to a secret, but unnecessary in a log line and large.
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
  /**
   * Additional field names to treat as sensitive, on top of
   * {@link SENSITIVE_LOG_FIELDS}. Use this for consumer-specific fields (e.g.
   * an email or phone number your own `details` payloads add before they
   * reach the shared hook).
   */
  extraFields?: readonly string[];
  /** Maximum object nesting depth to walk before leaving remaining values
   * untouched. Defaults to 6 — deep enough for any shape this SDK's hooks
   * produce, shallow enough to bound the work on an adversarial/circular
   * consumer-supplied object. */
  maxDepth?: number;
}

/**
 * Return a deep copy of `value` with every sensitive field (by name, see
 * {@link SENSITIVE_LOG_FIELDS}) replaced with {@link REDACTED}. Field-name
 * matching is case-insensitive so `SecretKey`, `secretkey`, and `secret_key`
 * (naive snake_case) are all caught.
 *
 * Safe to call on whatever a consumer is about to pass to their logger:
 * arrays are walked, non-plain values (functions, `Error`, `Date`, class
 * instances, XDR/`ScVal`-shaped objects) are passed through as-is rather than
 * spread into `{}` and losing their meaning — this is a redaction filter, not
 * a serializer. `undefined`/`null` pass through unchanged.
 *
 * Does not mutate `value`.
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

  // Only walk into plain objects — an Error, Date, Map, ScVal/XDR class
  // instance, etc. is passed through untouched rather than flattened.
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
