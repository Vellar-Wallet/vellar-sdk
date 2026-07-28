import { describe, expect, it } from "vitest";
import { MAINNET } from "../../../src/config";
import { MAINNET_CAIP2 } from "./mainnet-network-info";

describe("mainnet network info", () => {
  it("exposes the canonical mainnet passphrase from src/config", () => {
    expect(MAINNET.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });

  it("exposes the stellar:pubnet CAIP-2 identifier", () => {
    expect(MAINNET_CAIP2).toBe("stellar:pubnet");
  });
});
