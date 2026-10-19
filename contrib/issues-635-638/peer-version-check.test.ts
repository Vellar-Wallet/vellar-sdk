import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  checkStellarSdkPeerVersion,
  readStellarSdkVersion,
  STELLAR_SDK_PEER_RANGE,
} from "./peer-version-check";

vi.mock("@stellar/stellar-sdk", () => ({ version: "15.4.0" }));

describe("checkStellarSdkPeerVersion", () => {
  it("warns (does not throw) when the module reports an out-of-range version", () => {
    const warn = vi.fn();
    const result = checkStellarSdkPeerVersion({ warn });
    expect(result.ok).toBe(false);
    expect(result.installed).toBe("15.4.0");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/15\.4\.0.*outside the supported peer range "\^16\.0\.0"/);
    expect(warn.mock.calls[0]![0]).toMatch(/npm install/);
  });

  it("reads the version from the mocked stellar-sdk module", () => {
    expect(readStellarSdkVersion()).toBe("15.4.0");
  });

  it("is silent for in-range versions, floor and latest", () => {
    const warn = vi.fn();
    for (const v of ["16.0.0", "16.3.1"]) {
      expect(checkStellarSdkPeerVersion({ warn, readVersion: () => v }).ok).toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for a major above the range", () => {
    const warn = vi.fn();
    expect(checkStellarSdkPeerVersion({ warn, readVersion: () => "17.2.1" }).ok).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stays silent when the version cannot be determined", () => {
    const warn = vi.fn();
    const result = checkStellarSdkPeerVersion({ warn, readVersion: () => null });
    expect(result).toMatchObject({ ok: true, installed: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to console.warn by default", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkStellarSdkPeerVersion();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("default range matches package.json peerDependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(STELLAR_SDK_PEER_RANGE).toBe(pkg.peerDependencies["@stellar/stellar-sdk"]);
  });
});
