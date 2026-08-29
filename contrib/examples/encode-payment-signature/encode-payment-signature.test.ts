import { describe, expect, it } from "vitest";
import { encodePaymentSignature } from "./encode-payment-signature";

describe("encodePaymentSignature", () => {
  it("base64-encodes the JSON payload, decodable back to the original", () => {
    const payload = { x402Version: 2, accepted: { scheme: "exact" } };
    const encoded = encodePaymentSignature(payload);
    expect(JSON.parse(atob(encoded))).toEqual(payload);
  });

  it("produces a stable encoding for the same input", () => {
    const payload = { a: 1, b: "two" };
    expect(encodePaymentSignature(payload)).toBe(encodePaymentSignature(payload));
  });
});
