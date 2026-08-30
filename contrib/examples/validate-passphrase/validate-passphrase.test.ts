import { describe, expect, it } from "vitest";
import { MAINNET, TESTNET } from "../../../src/config";
import { matchNetworkPassphrase } from "./validate-passphrase";

describe("matchNetworkPassphrase", () => {
  it("matches the testnet passphrase", () => {
    expect(matchNetworkPassphrase(TESTNET.networkPassphrase)).toBe("testnet");
  });

  it("matches the mainnet passphrase", () => {
    expect(matchNetworkPassphrase(MAINNET.networkPassphrase)).toBe("mainnet");
  });

  it("returns null for an unknown string", () => {
    expect(matchNetworkPassphrase("Not a real passphrase")).toBeNull();
  });

  it("is case-sensitive — a different-case match returns null", () => {
    expect(matchNetworkPassphrase(TESTNET.networkPassphrase.toLowerCase())).toBeNull();
  });

  it("does not trim — surrounding whitespace returns null", () => {
    expect(matchNetworkPassphrase(` ${TESTNET.networkPassphrase} `)).toBeNull();
  });
});
