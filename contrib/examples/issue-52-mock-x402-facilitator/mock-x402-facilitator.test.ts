/**
 * mock-x402-facilitator.test.ts
 *
 * Tests for the mock x402 facilitator client.
 *
 * Run from the repo root:
 *   npx vitest run contrib/examples/issue-52-mock-x402-facilitator/mock-x402-facilitator.test.ts
 *
 * Or run the full suite:
 *   npm test
 */

import { describe, it, expect } from "vitest";
import {
  createMockFacilitator,
  makeRequirements,
  makePaymentHeader,
  type PaymentRequirements,
} from "./mock-x402-facilitator";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const REQ = makeRequirements();
const HEADER = makePaymentHeader(REQ);

// ─────────────────────────────────────────────────────────────────────────────
// verify — success path
// ─────────────────────────────────────────────────────────────────────────────

describe("verify — success path", () => {
  it("returns success: true for a valid header + requirements", async () => {
    const f = createMockFacilitator();
    const result = await f.verify(HEADER, REQ);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejectVerify defaults to false — no config needed for happy path", async () => {
    const f = createMockFacilitator({});
    const result = await f.verify(HEADER, REQ);
    expect(result.success).toBe(true);
  });

  it("result.message is a non-empty string on success", async () => {
    const f = createMockFacilitator();
    const result = await f.verify(HEADER, REQ);
    expect(typeof result.message).toBe("string");
    expect(result.message!.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify — rejection path
// ─────────────────────────────────────────────────────────────────────────────

describe("verify — rejection path", () => {
  it("returns success: false when rejectVerify is true", async () => {
    const f = createMockFacilitator({ rejectVerify: true });
    const result = await f.verify(HEADER, REQ);
    expect(result.success).toBe(false);
  });

  it("defaults to DAILY_LIMIT_EXCEEDED error code when rejectReason is not set", async () => {
    const f = createMockFacilitator({ rejectVerify: true });
    const result = await f.verify(HEADER, REQ);
    expect(result.error).toBe("DAILY_LIMIT_EXCEEDED");
  });

  it("uses custom rejectReason when provided", async () => {
    const f = createMockFacilitator({ rejectVerify: true, rejectReason: "INVALID_SIGNATURE" });
    const result = await f.verify(HEADER, REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_SIGNATURE");
  });

  it("supports EXPIRED as a rejectReason", async () => {
    const f = createMockFacilitator({ rejectVerify: true, rejectReason: "EXPIRED" });
    const result = await f.verify(HEADER, REQ);
    expect(result.error).toBe("EXPIRED");
  });

  it("supports ASSET_NOT_SUPPORTED as a rejectReason", async () => {
    const f = createMockFacilitator({
      rejectVerify: true,
      rejectReason: "ASSET_NOT_SUPPORTED",
    });
    const result = await f.verify(HEADER, REQ);
    expect(result.error).toBe("ASSET_NOT_SUPPORTED");
  });

  it("result.message describes the rejection on failure", async () => {
    const f = createMockFacilitator({ rejectVerify: true, rejectReason: "AMOUNT_MISMATCH" });
    const result = await f.verify(HEADER, REQ);
    expect(result.message).toBeDefined();
    expect(result.message!.toLowerCase()).toContain("amount_mismatch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify — structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("verify — structural validation", () => {
  it("rejects an empty header with MISSING_HEADER", async () => {
    const f = createMockFacilitator();
    const result = await f.verify("", REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_HEADER");
  });

  it("rejects requirements missing the asset field", async () => {
    const f = createMockFacilitator();
    const bad: PaymentRequirements = { ...REQ, asset: "" };
    const result = await f.verify(HEADER, bad);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REQUIREMENTS");
  });

  it("rejects requirements missing the payTo field", async () => {
    const f = createMockFacilitator();
    const bad: PaymentRequirements = { ...REQ, payTo: "" };
    const result = await f.verify(HEADER, bad);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REQUIREMENTS");
  });

  it("rejects a non-integer amount string", async () => {
    const f = createMockFacilitator();
    const bad: PaymentRequirements = { ...REQ, amount: "1.5" };
    const result = await f.verify(HEADER, bad);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REQUIREMENTS");
  });

  it("rejects a non-numeric amount string", async () => {
    const f = createMockFacilitator();
    const bad: PaymentRequirements = { ...REQ, amount: "abc" };
    const result = await f.verify(HEADER, bad);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REQUIREMENTS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// settle — success path
// ─────────────────────────────────────────────────────────────────────────────

describe("settle — success path", () => {
  it("returns success: true for a valid header + requirements", async () => {
    const f = createMockFacilitator();
    const result = await f.settle(HEADER, REQ);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns a transaction hash on success", async () => {
    const f = createMockFacilitator();
    const result = await f.settle(HEADER, REQ);
    expect(result.transaction).toBeDefined();
    expect(typeof result.transaction).toBe("string");
    expect(result.transaction!.length).toBeGreaterThan(0);
  });

  it("returns the configured settleTxHash when provided", async () => {
    const fixed = "a".repeat(64);
    const f = createMockFacilitator({ settleTxHash: fixed });
    const result = await f.settle(HEADER, REQ);
    expect(result.transaction).toBe(fixed);
  });

  it("returns the same derived hash for the same header (deterministic)", async () => {
    const f = createMockFacilitator();
    const r1 = await f.settle(HEADER, REQ);
    const r2 = await f.settle(HEADER, REQ);
    expect(r1.transaction).toBe(r2.transaction);
  });

  it("returns different hashes for different headers", async () => {
    const f = createMockFacilitator();
    const reqB = makeRequirements({ amount: "5000000" });
    const headerB = makePaymentHeader(reqB);
    const r1 = await f.settle(HEADER, REQ);
    const r2 = await f.settle(headerB, reqB);
    expect(r1.transaction).not.toBe(r2.transaction);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// settle — rejection path
// ─────────────────────────────────────────────────────────────────────────────

describe("settle — rejection path", () => {
  it("returns success: false when rejectVerify is true (settle should not proceed)", async () => {
    const f = createMockFacilitator({ rejectVerify: true });
    const result = await f.settle(HEADER, REQ);
    expect(result.success).toBe(false);
    expect(result.transaction).toBeUndefined();
  });

  it("returns success: false when rejectSettle is true", async () => {
    const f = createMockFacilitator({ rejectSettle: true });
    const result = await f.settle(HEADER, REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe("SUBMISSION_FAILED");
  });

  it("uses custom settleRejectReason when provided", async () => {
    const f = createMockFacilitator({
      rejectSettle: true,
      settleRejectReason: "NETWORK_CONGESTION",
    });
    const result = await f.settle(HEADER, REQ);
    expect(result.error).toBe("NETWORK_CONGESTION");
  });

  it("rejects settlement for an empty header", async () => {
    const f = createMockFacilitator();
    const result = await f.settle("", REQ);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_HEADER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full verify → settle flow
// ─────────────────────────────────────────────────────────────────────────────

describe("full verify → settle flow", () => {
  it("happy path: verify succeeds then settle returns a tx hash", async () => {
    const f = createMockFacilitator();

    const verifyResult = await f.verify(HEADER, REQ);
    expect(verifyResult.success).toBe(true);

    const settleResult = await f.settle(HEADER, REQ);
    expect(settleResult.success).toBe(true);
    expect(settleResult.transaction).toBeDefined();
  });

  it("rejection path: verify fails, no settlement attempted", async () => {
    const f = createMockFacilitator({ rejectVerify: true });

    const verifyResult = await f.verify(HEADER, REQ);
    expect(verifyResult.success).toBe(false);
    expect(verifyResult.error).toBe("DAILY_LIMIT_EXCEEDED");

    // A well-behaved client should not call settle after a verify failure,
    // but the mock also rejects it if called — both paths are covered.
    const settleResult = await f.settle(HEADER, REQ);
    expect(settleResult.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("makeRequirements", () => {
  it("returns a valid requirements object", () => {
    const req = makeRequirements();
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("stellar:testnet");
    expect(typeof req.asset).toBe("string");
    expect(req.asset.length).toBeGreaterThan(0);
    expect(/^\d+$/.test(req.amount)).toBe(true);
    expect(typeof req.payTo).toBe("string");
  });

  it("accepts overrides", () => {
    const req = makeRequirements({ amount: "99999999", network: "stellar:pubnet" });
    expect(req.amount).toBe("99999999");
    expect(req.network).toBe("stellar:pubnet");
    // Non-overridden fields are still present
    expect(req.scheme).toBe("exact");
  });
});

describe("makePaymentHeader", () => {
  it("returns a non-empty base64 string", () => {
    const header = makePaymentHeader();
    expect(typeof header).toBe("string");
    expect(header.length).toBeGreaterThan(0);
  });

  it("encodes valid JSON containing the requirements", () => {
    const req = makeRequirements({ amount: "2000000" });
    const header = makePaymentHeader(req);
    const decoded = JSON.parse(atob(header));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.amount).toBe("2000000");
    expect(decoded.payload.transaction).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Latency simulation
// ─────────────────────────────────────────────────────────────────────────────

describe("latency simulation", () => {
  it("latencyMs=0 (default) completes without artificial delay", async () => {
    const f = createMockFacilitator({ latencyMs: 0 });
    const start = Date.now();
    await f.verify(HEADER, REQ);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("latencyMs introduces at least that much delay on verify", async () => {
    const f = createMockFacilitator({ latencyMs: 50 });
    const start = Date.now();
    await f.verify(HEADER, REQ);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45); // allow slight timer drift
  });
});
