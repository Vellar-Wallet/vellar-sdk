// Signed-request auth between the SDK and a vellar-facilitator deployment.
//
// WHY THIS EXISTS (#226): the x402 payment payload itself is already signed
// (the smart-wallet auth entry, via x402-signer.ts) — that proves the PAYMENT
// is authentic. It says nothing about the REQUEST that carries it: today
// nothing stops a network intermediary between the SDK and the facilitator
// from replaying a captured `PAYMENT-SIGNATURE` request against a different
// resource, or from a facilitator operator running multiple logical
// deployments behind one host telling requests apart only by transport (TLS)
// identity. This adds a second, independent signature over the REQUEST
// (method + path + body + timestamp + nonce) using a shared secret
// provisioned out of band between an integrator and their facilitator
// deployment — the same trust boundary `x402.rpcUrl` already assumes.
//
// This is OPT-IN and deliberately narrow:
//   - It authenticates the SDK → facilitator HTTP request, not the on-chain
//     payment (that's the auth-entry signature) and not the facilitator's
//     response (facilitators are free to also sign responses; verifying that
//     is the integrator's concern, symmetric to this one, and out of scope
//     here).
//   - It is HMAC-SHA256 over a canonical string, using the Web Crypto API —
//     the same "no Buffer, no node:crypto" constraint as x402-untrusted.ts,
//     because this SDK ships to browsers and bundlers.
//   - Clock skew and nonce tracking are the SERVER's job (rejecting stale
//     timestamps / replayed nonces); this module only PRODUCES a correctly
//     shaped, correctly signed header. A client cannot enforce anti-replay on
//     its own requests.

/** A signed-request credential: a key id (so the facilitator can look up which
 * secret to verify against without guessing) and the shared secret itself. */
export interface FacilitatorRequestSigningConfig {
  /** Identifies which secret was used, e.g. an API key id. Sent in the clear. */
  keyId: string;
  /** Shared secret, provisioned out of band with the facilitator operator.
   * Never logged, never sent — only used to derive the signature locally. */
  secret: string;
  /** Clock source (defaults to `Date.now`); overridable for tests. */
  now?: () => number;
  /** Nonce source (defaults to a Web Crypto random hex string); overridable
   * for tests so a signature's canonical string is reproducible. */
  nonce?: () => string;
}

/** The header set a signed request carries, matching what the facilitator verifies. */
export interface SignedRequestHeaders {
  "X-Vellar-Key-Id": string;
  "X-Vellar-Timestamp": string;
  "X-Vellar-Nonce": string;
  "X-Vellar-Signature": string;
}

const ALGORITHM = "HMAC-SHA256";
const HEADER_KEY_ID = "X-Vellar-Key-Id";
const HEADER_TIMESTAMP = "X-Vellar-Timestamp";
const HEADER_NONCE = "X-Vellar-Nonce";
const HEADER_SIGNATURE = "X-Vellar-Signature";

/** Thrown when the Web Crypto SubtleCrypto API is unavailable. See the
 * identical rationale in x402-untrusted.ts's `nonce()` — no silent fallback. */
export class RequestSigningUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `${operation} requires the Web Crypto API (globalThis.crypto.subtle), which this ` +
        "runtime does not expose. Node 18 and earlier need --experimental-global-webcrypto; " +
        "Node 20+ and all browsers work out of the box. There is deliberately no " +
        "non-cryptographic fallback for a request signature.",
    );
    this.name = "RequestSigningUnavailableError";
  }
}

/** A signed-request header failed local validation before ever reaching the wire. */
export class InvalidSigningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSigningConfigError";
  }
}

function requireSubtleCrypto(operation: string): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new RequestSigningUnavailableError(operation);
  return subtle;
}

function randomNonce(): string {
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.getRandomValues !== "function") {
    throw new RequestSigningUnavailableError("vellar-sdk/x402-request-auth nonce generation");
  }
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The canonical string signed. Order and delimiter are fixed — the facilitator
 * must build the identical string to verify, so this format is a breaking
 * change to touch. Newline-joined, matching common HMAC request-signing
 * schemes (AWS SigV4, Stripe webhooks) so it can be verified with an ordinary
 * server-side crypto library, not just this SDK.
 *
 * The body is signed EXACTLY as sent — the facilitator must verify against the
 * raw bytes it received, not a re-serialized version, or a semantically
 * identical but byte-different body (key order, whitespace) would fail
 * verification for a legitimate request.
 */
export function canonicalRequestString(input: {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.body,
  ].join("\n");
}

function assertConfig(config: FacilitatorRequestSigningConfig): void {
  if (!config.keyId || config.keyId.trim().length === 0) {
    throw new InvalidSigningConfigError("facilitator request signing requires a non-empty keyId");
  }
  if (!config.secret || config.secret.length === 0) {
    throw new InvalidSigningConfigError("facilitator request signing requires a non-empty secret");
  }
}

/**
 * Sign one outgoing request to the facilitator, returning the headers to merge
 * into the request. `path` should be the request path the facilitator's route
 * matches on (e.g. `/verify`, `/settle`) — not the full URL, so a signature
 * survives being fronted by a different host/CDN than it was signed for.
 */
export async function signFacilitatorRequest(
  config: FacilitatorRequestSigningConfig,
  request: { method: string; path: string; body?: string },
): Promise<SignedRequestHeaders> {
  assertConfig(config);
  const subtle = requireSubtleCrypto("signFacilitatorRequest");

  const timestamp = String(Math.floor((config.now ?? Date.now)() / 1000));
  const nonce = (config.nonce ?? randomNonce)();
  const body = request.body ?? "";

  const canonical = canonicalRequestString({
    method: request.method,
    path: request.path,
    body,
    timestamp,
    nonce,
  });

  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  const signature = toBase64(new Uint8Array(digest));

  return {
    [HEADER_KEY_ID]: config.keyId,
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_NONCE]: nonce,
    [HEADER_SIGNATURE]: `${ALGORITHM} ${signature}`,
  };
}

/**
 * Verify a request's signature, for a facilitator (or a test double standing
 * in for one) implemented in TypeScript. Not used by the SDK's own outgoing
 * calls — provided so an integrator's facilitator-side verification and the
 * SDK's signing share one implementation of the canonical string and never
 * drift apart.
 *
 * Uses a constant-time comparison so response timing cannot leak how many
 * leading bytes of an attacker-supplied signature matched.
 */
export async function verifyFacilitatorRequest(
  secret: string,
  headers: {
    keyId: string;
    timestamp: string;
    nonce: string;
    signature: string;
  },
  request: { method: string; path: string; body?: string },
  opts: { toleranceSeconds?: number; now?: () => number } = {},
): Promise<boolean> {
  const subtle = requireSubtleCrypto("verifyFacilitatorRequest");
  const [algorithm, provided] = headers.signature.split(" ", 2);
  if (algorithm !== ALGORITHM || !provided) return false;

  const tolerance = opts.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((opts.now ?? Date.now)() / 1000);
  const requestSeconds = Number(headers.timestamp);
  if (!Number.isFinite(requestSeconds) || Math.abs(nowSeconds - requestSeconds) > tolerance) {
    return false;
  }

  const canonical = canonicalRequestString({
    method: request.method,
    path: request.path,
    body: request.body ?? "",
    timestamp: headers.timestamp,
    nonce: headers.nonce,
  });

  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );
  const expected = toBase64(digest);

  return timingSafeEqual(expected, provided);
}

/** Constant-time string comparison — length is not secret, but content is. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const SIGNED_REQUEST_HEADER_NAMES = {
  keyId: HEADER_KEY_ID,
  timestamp: HEADER_TIMESTAMP,
  nonce: HEADER_NONCE,
  signature: HEADER_SIGNATURE,
} as const;

/**
 * Wrap a {@link FetchLike}-shaped function so every outgoing request also
 * carries the signed-request headers. Drop-in for `X402ClientDeps.fetchImpl` /
 * `X402FacadeDeps.config.fetchImpl` — signing is entirely transparent to
 * `createX402Client`.
 *
 * A `ReadableStream` body cannot be read here without consuming it for the
 * real request, so it is signed as an EMPTY body — this matches
 * `x402-client.ts`'s own refusal of stream bodies on the payment retry (a
 * stream can't be replayed either), so no code path signs a stream body
 * while its bytes are still unread.
 */
export function createSignedFetch(
  config: FacilitatorRequestSigningConfig,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) =>
    fetch(url, init),
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(url, "http://placeholder.invalid").pathname;
    const body = typeof init?.body === "string" ? init.body : "";

    const signedHeaders = await signFacilitatorRequest(config, { method, path, body });

    return fetchImpl(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...signedHeaders },
    });
  };
}
