import { describe, expect, it } from "vitest";
import { inspectMainnetConfigInput } from "./mainnet-config-preflight.js";

const RPC = "https://rpc.example.com";
const HASH = "a".repeat(64);

describe("mainnet config preflight (#857, #858)", () => {
  it("identifies a missing hash independently from a valid RPC URL", () => {
    expect(inspectMainnetConfigInput({ rpcUrl: RPC })).toEqual([
      expect.objectContaining({ field: "walletWasmHash", reason: "missing" }),
    ]);
  });

  it("identifies a missing RPC URL independently from a valid hash", () => {
    expect(inspectMainnetConfigInput({ walletWasmHash: HASH })).toEqual([
      expect.objectContaining({ field: "rpcUrl", reason: "missing" }),
    ]);
  });

  it("distinguishes malformed values from omissions", () => {
    expect(inspectMainnetConfigInput({ rpcUrl: "ftp://rpc.example.com", walletWasmHash: "bad" })).toEqual([
      expect.objectContaining({ field: "rpcUrl", reason: "malformed" }),
      expect.objectContaining({ field: "walletWasmHash", reason: "malformed" }),
    ]);
  });
});
