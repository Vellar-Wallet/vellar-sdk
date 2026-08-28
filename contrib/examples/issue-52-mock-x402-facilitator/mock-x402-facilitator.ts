/**
 * mock-x402-facilitator.ts
 *
 * A self-contained mock x402 facilitator client with `verify` and `settle`
 * functions that match the general shape used by the Vellar SDK client.
 *
 * The x402 facilitator is the server-side component that:
 *   1. Receives a `PAYMENT-SIGNATURE` header from the paying client.
 *   2. Calls `verify` — validates the signed Soroban auth entry without
 *      settling on-chain (fast, cheap, used to gate access).
 *   3. Calls `settle` — submits the signed transaction to the network and
 *      returns the on-chain settlement hash.
 *
 * This mock skips all network/XDR work and instead returns canned responses
 * controlled by configuration flags. It is useful for testing x402 client
 * flows, resource-server middleware, and error-path handling in isolation.
 *
 * Usage in tests:
 *
 *   const facilitator = createMockFacilitator({ rejectVerify: false });
 *   const verifyResult = await facilitator.verify(paymentHeader, requirements);
 *   if (!verifyResult.success) throw new Error(verifyResult.error);
 *   const settlement = await facilitator.settle(paymentHeader, requirements);
 *
 * To simulate a failure path:
 *
 *   const facilitator = createMockFacilitator({ rejectVerify: true });
 *   const result = await facilitator.verify(paymentHeader, requirements);
 *   // result.success === false, result.error === "DAILY_LIMIT_EXCEEDED"
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared types — mirror the real facilitator API shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payment requirements for one accepted option, as decoded from a 402 response.
 * Mirrors `PaymentRequirements` in `src/x402-types.ts`.
 */
export interface PaymentRequirements {
  scheme: string;        // "exact"
  network: string;       // CAIP-2 e.g. "stellar:testnet"
  asset: string;         // SAC contract id
  amount: string;        // base units as a decimal string
  payTo: string;         // recipient address
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/**
 * The decoded payment payload extracted from the `PAYMENT-SIGNATURE` header
 * (base64 JSON). The SDK sets `x402Version`, `accepted`, and `payload.transaction`
 * (the base64 XDR of the built SEP-41 transfer).
 */
export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirements;
  payload: {
    /** Base64 XDR of the assembled + auth-signed SEP-41 transfer transaction. */
    transaction: string;
  };
}

/** Result of a `verify` call. */
export interface VerifyResult {
  /** True when the payment is valid and can be settled. */
  success: boolean;
  /**
   * Machine-readable rejection reason, present when `success` is false.
   * Common values from real facilitators:
   *   "DAILY_LIMIT_EXCEEDED", "INVALID_SIGNATURE", "AMOUNT_MISMATCH",
   *   "EXPIRED", "ASSET_NOT_SUPPORTED"
   */
  error?: string;
  /** Optional human-readable detail for logging. */
  message?: string;
}

/** Result of a `settle` call. */
export interface SettleResult {
  /** True when the transaction was successfully submitted on-chain. */
  success: boolean;
  /** On-chain transaction hash, present on success. */
  transaction?: string;
  /** Rejection reason, present on failure. */
  error?: string;
  /** Optional human-readable detail for logging. */
  message?: string;
}

/**
 * The facilitator client interface. Mirrors the surface the SDK's x402 client
 * expects from a real hosted facilitator, adapted for direct function calls
 * (the real client calls these via HTTP; tests call them directly).
 */
export interface FacilitatorClient {
  /**
   * Verify a signed payment without settling.
   *
   * @param paymentHeader - The raw value of the `PAYMENT-SIGNATURE` header.
   * @param requirements  - The payment requirements the signature must satisfy.
   */
  verify(paymentHeader: string, requirements: PaymentRequirements): Promise<VerifyResult>;

  /**
   * Settle a previously verified payment by submitting the transaction on-chain.
   *
   * @param paymentHeader - The raw value of the `PAYMENT-SIGNATURE` header.
   * @param requirements  - The payment requirements the signature must satisfy.
   */
  settle(paymentHeader: string, requirements: PaymentRequirements): Promise<SettleResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface MockFacilitatorConfig {
  /**
   * When `true`, `verify` returns a failure result instead of success.
   * Useful for testing the client's rejection-handling path (e.g. spending
   * limit exceeded, invalid signature).
   *
   * `settle` is not called in the normal flow when `verify` fails, but if
   * called directly it will also fail when this flag is set.
   *
   * @default false
   */
  rejectVerify?: boolean;

  /**
   * The machine-readable error code to return when `rejectVerify` is `true`.
   *
   * @default "DAILY_LIMIT_EXCEEDED"
   */
  rejectReason?: string;

  /**
   * When `true`, `settle` fails even if `verify` would pass. Lets you test
   * the narrow window where on-chain submission fails after a successful verify.
   *
   * @default false
   */
  rejectSettle?: boolean;

  /**
   * The error code to return when `rejectSettle` is `true`.
   *
   * @default "SUBMISSION_FAILED"
   */
  settleRejectReason?: string;

  /**
   * A fixed transaction hash to return on successful `settle` calls. When
   * omitted a deterministic pseudo-hash is derived from the payment header so
   * repeated calls with the same input return the same hash (useful for
   * assertions in tests without requiring a real network).
   */
  settleTxHash?: string;

  /**
   * Optional delay in milliseconds applied to both `verify` and `settle`.
   * Simulates network latency in integration tests.
   *
   * @default 0
   */
  latencyMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a deterministic pseudo-hash from a payment header string. Not
 * cryptographic — only used to generate stable mock transaction hashes so tests
 * can assert on a consistent value without a real network.
 */
function deriveMockTxHash(header: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < header.length; i++) {
    h ^= header.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  // Pad to 64 hex chars (real Stellar tx hashes are 32 bytes = 64 hex chars).
  return h.toString(16).padStart(8, "0").repeat(8);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock x402 facilitator client.
 *
 * @param config - Optional configuration flags. All fields have sensible defaults.
 * @returns A `FacilitatorClient` with `verify` and `settle` methods.
 *
 * @example
 * // Happy path
 * const facilitator = createMockFacilitator();
 * const result = await facilitator.verify(header, requirements);
 * // { success: true }
 *
 * @example
 * // Failure path — spending limit exceeded
 * const facilitator = createMockFacilitator({
 *   rejectVerify: true,
 *   rejectReason: "DAILY_LIMIT_EXCEEDED",
 * });
 * const result = await facilitator.verify(header, requirements);
 * // { success: false, error: "DAILY_LIMIT_EXCEEDED", message: "..." }
 */
export function createMockFacilitator(config: MockFacilitatorConfig = {}): FacilitatorClient {
  const {
    rejectVerify = false,
    rejectReason = "DAILY_LIMIT_EXCEEDED",
    rejectSettle = false,
    settleRejectReason = "SUBMISSION_FAILED",
    settleTxHash,
    latencyMs = 0,
  } = config;

  return {
    async verify(paymentHeader, requirements): Promise<VerifyResult> {
      if (latencyMs > 0) await delay(latencyMs);

      // Basic structural validation — a real facilitator does this too, and
      // the mock mirrors it so tests catch malformed header bugs early.
      if (!paymentHeader || typeof paymentHeader !== "string") {
        return {
          success: false,
          error: "MISSING_HEADER",
          message: "PAYMENT-SIGNATURE header is required.",
        };
      }
      if (!requirements.asset || !requirements.amount || !requirements.payTo) {
        return {
          success: false,
          error: "INVALID_REQUIREMENTS",
          message: "Payment requirements are incomplete (asset, amount, payTo are required).",
        };
      }
      if (!/^\d+$/.test(requirements.amount)) {
        return {
          success: false,
          error: "INVALID_REQUIREMENTS",
          message: `Payment requirements contain a non-integer amount: ${JSON.stringify(requirements.amount)}.`,
        };
      }

      if (rejectVerify) {
        return {
          success: false,
          error: rejectReason,
          message: `Mock facilitator rejected the payment: ${rejectReason}.`,
        };
      }

      return {
        success: true,
        message: "Mock facilitator: payment verified successfully.",
      };
    },

    async settle(paymentHeader, requirements): Promise<SettleResult> {
      if (latencyMs > 0) await delay(latencyMs);

      // Settle must not proceed if the requirements are structurally invalid.
      if (!paymentHeader || typeof paymentHeader !== "string") {
        return {
          success: false,
          error: "MISSING_HEADER",
          message: "PAYMENT-SIGNATURE header is required.",
        };
      }
      if (!requirements.asset || !requirements.amount || !requirements.payTo) {
        return {
          success: false,
          error: "INVALID_REQUIREMENTS",
          message: "Payment requirements are incomplete.",
        };
      }

      // A verify failure means settlement should never proceed in normal flow.
      // Allow the flag to also gate settle so callers can simulate early errors.
      if (rejectVerify || rejectSettle) {
        const reason = rejectSettle ? settleRejectReason : rejectReason;
        return {
          success: false,
          error: reason,
          message: `Mock facilitator rejected settlement: ${reason}.`,
        };
      }

      const transaction = settleTxHash ?? deriveMockTxHash(paymentHeader);
      return {
        success: true,
        transaction,
        message: "Mock facilitator: payment settled successfully.",
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — useful for building test fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid `PaymentRequirements` fixture for tests.
 * Override individual fields by spreading the result:
 *
 *   { ...makeRequirements(), amount: "99999999999" }
 */
export function makeRequirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: "1000000",  // 0.1 XLM in stroops (7 decimals)
    payTo: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV4HRKNXNEW",
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

/**
 * Build a minimal valid `PAYMENT-SIGNATURE` header value for tests. The
 * content is base64 JSON matching the shape the SDK client produces.
 *
 * Optionally pass `requirements` to embed in the payload; defaults to
 * `makeRequirements()`.
 */
export function makePaymentHeader(
  requirements: PaymentRequirements = makeRequirements(),
): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      // Placeholder XDR — not a real transaction; enough for structural tests.
      transaction: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    },
  };
  // Browser-safe base64 encode (no Buffer / Node.js dependency).
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
