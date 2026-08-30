import { describe, expect, it } from "vitest";
import { buildPaymentRequirements } from "./build-payment-requirements";

describe("buildPaymentRequirements", () => {
  it("builds a scheme=exact requirements object", () => {
    expect(
      buildPaymentRequirements({
        network: "stellar:testnet",
        asset: "CUSDC",
        amount: "2500000",
        payTo: "CPAYTO",
      }),
    ).toEqual({
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CUSDC",
      amount: "2500000",
      payTo: "CPAYTO",
    });
  });

  it("rejects a non-digit amount", () => {
    expect(() =>
      buildPaymentRequirements({ network: "stellar:testnet", asset: "CUSDC", amount: "2.5", payTo: "CPAYTO" }),
    ).toThrow(/must be a plain digit string/);
  });

  it("rejects an empty amount", () => {
    expect(() =>
      buildPaymentRequirements({ network: "stellar:testnet", asset: "CUSDC", amount: "", payTo: "CPAYTO" }),
    ).toThrow(/must be a plain digit string/);
  });
});
