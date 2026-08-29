import { describe, expect, it } from "vitest";
import { decodePaymentRequiredHeader } from "./decode-payment-required";

describe("decodePaymentRequiredHeader", () => {
  it("decodes a valid base64 JSON payload", () => {
    const sample = { x402Version: 2, accepts: [{ scheme: "exact" }] };
    const encoded = btoa(JSON.stringify(sample));
    expect(decodePaymentRequiredHeader(encoded)).toEqual(sample);
  });

  it("throws a clear error for a string that is not valid base64", () => {
    expect(() => decodePaymentRequiredHeader("not-valid-base64!!!")).toThrow(
      /not valid base64/,
    );
  });

  it("throws a clear error when the decoded content is not valid JSON", () => {
    const notJson = btoa("this is not json");
    expect(() => decodePaymentRequiredHeader(notJson)).toThrow(/not valid JSON/);
  });
});
