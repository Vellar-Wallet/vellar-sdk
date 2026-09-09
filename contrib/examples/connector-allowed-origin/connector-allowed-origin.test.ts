import { describe, it, expect } from "vitest";
import { ConnectorOriginGuard } from "./connector-allowed-origin";

describe("Issue #259 — Connector Allowed-Origin Guard", () => {
  it("allows configured origins", () => {
    const guard = new ConnectorOriginGuard(["https://app.vellar.co"]);
    expect(() => guard.verifyOrigin("https://app.vellar.co")).not.toThrow();
  });

  it("rejects unknown origins", () => {
    const guard = new ConnectorOriginGuard(["https://app.vellar.co"]);
    expect(() => guard.verifyOrigin("https://evil.com")).toThrow("Origin not allowed: https://evil.com");
  });

  it("handles localhost appropriately", () => {
    const withLocalhost = new ConnectorOriginGuard(["https://app.vellar.co"], true);
    expect(() => withLocalhost.verifyOrigin("http://localhost:3000")).not.toThrow();
    expect(() => withLocalhost.verifyOrigin("http://127.0.0.1:8080")).not.toThrow();

    const withoutLocalhost = new ConnectorOriginGuard(["https://app.vellar.co"], false);
    expect(() => withoutLocalhost.verifyOrigin("http://localhost:3000")).toThrow("Origin not allowed: http://localhost:3000");
  });

  it("rejects missing origins", () => {
    const guard = new ConnectorOriginGuard(["https://app.vellar.co"]);
    expect(() => guard.verifyOrigin("")).toThrow("Origin is required for verification");
  });
});
