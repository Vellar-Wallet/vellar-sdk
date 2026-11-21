import { describe, expect, it } from "vitest";
import {
  HOSTED_TESTNET_FACILITATOR_URL,
  classifyFacilitator,
  isHostedTestnetFacilitator,
} from "./facilitator-host";

describe("classifyFacilitator", () => {
  it("recognises the exact documented hosted testnet URL", () => {
    expect(HOSTED_TESTNET_FACILITATOR_URL).toBe("https://vellar-facilitator.onrender.com");
    expect(classifyFacilitator("https://vellar-facilitator.onrender.com")).toBe("hosted-testnet");
    expect(isHostedTestnetFacilitator("https://vellar-facilitator.onrender.com")).toBe(true);
  });

  it("tolerates a trailing slash, host casing and surrounding whitespace", () => {
    expect(classifyFacilitator("https://vellar-facilitator.onrender.com/")).toBe("hosted-testnet");
    expect(classifyFacilitator("HTTPS://Vellar-Facilitator.onrender.com")).toBe("hosted-testnet");
    expect(classifyFacilitator("  https://vellar-facilitator.onrender.com  ")).toBe("hosted-testnet");
  });

  it("classifies a self-run looking URL as self-run", () => {
    expect(classifyFacilitator("https://facilitator.example.com")).toBe("self-run");
    expect(classifyFacilitator("http://localhost:4021")).toBe("self-run");
    expect(isHostedTestnetFacilitator("https://facilitator.example.com")).toBe(false);
  });

  it("does not match lookalike hosts or different paths on the hosted host", () => {
    expect(classifyFacilitator("https://vellar-facilitator.onrender.com.evil.test")).toBe("self-run");
    expect(classifyFacilitator("https://evil.test/https://vellar-facilitator.onrender.com")).toBe("self-run");
    expect(classifyFacilitator("https://vellar-facilitator.onrender.com/v2")).toBe("self-run");
  });

  it("treats unparseable input as self-run without throwing", () => {
    expect(classifyFacilitator("")).toBe("self-run");
    expect(classifyFacilitator("not a url")).toBe("self-run");
  });
});
