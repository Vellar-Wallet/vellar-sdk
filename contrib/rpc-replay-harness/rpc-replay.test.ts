// Tests for the RPC record-and-replay harness.
//
// Verifies:
//   - Strict request matching (fails on unmatched requests)
//   - Secret stripping in recordings
//   - Deterministic replay (same recording → same response)
//   - Exhaustion handling

import { describe, expect, it } from "vitest";
import {
  assertNoSecretsInRecording,
  createReplayHandler,
  type RpcInteraction,
  stripSensitive,
} from "./rpc-replay.js";

const fixture: RpcInteraction[] = [
  {
    method: "simulateTransaction",
    params: { transaction: "AAAAfakeXDR" },
    response: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        results: [{ auth: ["AAAAauthXdr"], xdr: "AAAA==" }],
        latestLedger: 4143635,
      },
    },
  },
  {
    method: "getLatestLedger",
    params: {},
    response: {
      jsonrpc: "2.0",
      id: 2,
      result: { sequence: 4143708 },
    },
  },
];

describe("createReplayHandler", () => {
  it("replays a recorded response for a matching request", () => {
    const handler = createReplayHandler(fixture);
    const result = handler("simulateTransaction", { transaction: "AAAAfakeXDR" });
    expect(result).toEqual(fixture[0]!.response);
  });

  it("replays deterministically — same input, same output", () => {
    const handler1 = createReplayHandler(fixture);
    const handler2 = createReplayHandler(fixture);
    const r1 = handler1("simulateTransaction", { transaction: "AAAAfakeXDR" });
    const r2 = handler2("simulateTransaction", { transaction: "AAAAfakeXDR" });
    expect(r1).toEqual(r2);
  });

  it("fails loudly on an unmatched method", () => {
    const handler = createReplayHandler(fixture);
    expect(() => handler("unknownMethod", {})).toThrow(/no recording for method/);
  });

  it("fails loudly on mismatched params", () => {
    const handler = createReplayHandler(fixture);
    expect(() => handler("simulateTransaction", { transaction: "WRONG" })).toThrow(
      /params mismatch/,
    );
  });

  it("fails loudly when recordings for a method are exhausted", () => {
    const handler = createReplayHandler(fixture);
    handler("simulateTransaction", { transaction: "AAAAfakeXDR" });
    expect(() => handler("simulateTransaction", { transaction: "AAAAfakeXDR" })).toThrow(
      /exhausted/,
    );
  });

  it("handles multiple recordings for the same method", () => {
    const multi: RpcInteraction[] = [
      { method: "getLatestLedger", params: {}, response: { sequence: 1 } },
      { method: "getLatestLedger", params: {}, response: { sequence: 2 } },
    ];
    const handler = createReplayHandler(multi);
    expect(handler("getLatestLedger", {})).toEqual({ sequence: 1 });
    expect(handler("getLatestLedger", {})).toEqual({ sequence: 2 });
  });
});

describe("assertNoSecretsInRecording", () => {
  it("passes when no secret is present", () => {
    expect(() =>
      assertNoSecretsInRecording(fixture, ["SFAKESEEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]),
    ).not.toThrow();
  });

  it("throws when a secret IS present in the recording", () => {
    const secret = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABC";
    const leaked: RpcInteraction[] = [
      { method: "test", params: {}, response: { error: `signed by ${secret}` } },
    ];
    expect(() => assertNoSecretsInRecording(leaked, [secret])).toThrow(/contains a secret/);
  });
});

describe("stripSensitive", () => {
  it("strips Stellar secret-shaped strings from recordings", () => {
    const secret = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABC";
    const input: RpcInteraction[] = [
      {
        method: "test",
        params: {},
        response: { error: `key ${secret} was used` },
      },
    ];
    // Use stripSensitive to process, then verify the secret is gone.
    const result = stripSensitive(input, { secrets: [secret] });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[STRIPPED]");
  });

  it("strips unregistered secret-shaped values by pattern", () => {
    const secret = "SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const input = { error: `key ${secret} was used` };
    const result = stripSensitive(input, {});
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[STRIPPED]");
  });
});