import { describe, expect, it } from "vitest";
import { TESTNET } from "../../../src/config";
import { TESTNET_CAIP2 } from "./testnet-network-info";

describe("testnet network info", () => {
  it("exposes the canonical testnet passphrase from src/config", () => {
    expect(TESTNET.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("exposes the stellar:testnet CAIP-2 identifier", () => {
    expect(TESTNET_CAIP2).toBe("stellar:testnet");
  });
});
