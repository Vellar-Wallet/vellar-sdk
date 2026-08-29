import { describe, expect, it } from "vitest";
import { handleResourceRequest } from "./mock-x402-resource";

describe("handleResourceRequest", () => {
  it("returns 402 with a PAYMENT-REQUIRED header when no payment header is present", () => {
    const response = handleResourceRequest({ headers: {} });
    expect(response.status).toBe(402);
    expect(response.headers["PAYMENT-REQUIRED"]).toBeTruthy();

    const decoded = JSON.parse(atob(response.headers["PAYMENT-REQUIRED"]!));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0].scheme).toBe("exact");
  });

  it("returns 200 with the resource when a payment header is present", () => {
    const response = handleResourceRequest({
      headers: { "PAYMENT-SIGNATURE": "mock-signature-value" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: "the protected resource content" });
  });

  it("accepts a lowercase header name", () => {
    const response = handleResourceRequest({
      headers: { "payment-signature": "mock-signature-value" },
    });
    expect(response.status).toBe(200);
  });
});
