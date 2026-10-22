import { describe, expect, it, vi } from "vitest";
import {
  AgentsNotConfiguredError,
  InvalidAgentInputError,
  type AgentKeyRuntime,
} from "../../src/agents-facade.js";
import {
  AgentKeyNotFoundError,
  assertNoDuplicatePolicies,
  createHardenedAgentsFacade,
  revokeWithRetry,
  validateExpiresAt,
} from "./agent-mint-guard.js";

const AGENT_PK = "G".padEnd(56, "A");
const TOKEN = "C".padEnd(56, "B");
const OTHER_TOKEN = "C".padEnd(56, "E");
const SPENDING = "C".padEnd(56, "C");
const VERIFIED = "C".padEnd(56, "D");

function stubRuntime() {
  const addAgentKey = vi.fn<AgentKeyRuntime["addAgentKey"]>(async () => ({ hash: "addhash" }));
  const removeAgentKey = vi.fn<AgentKeyRuntime["removeAgentKey"]>(async () => ({ hash: "rmhash" }));
  const resume = vi.fn<NonNullable<AgentKeyRuntime["resume"]>>(async () => {});
  const runtime: AgentKeyRuntime = { addAgentKey, removeAgentKey, resume };
  return { runtime, addAgentKey, removeAgentKey, resume };
}

function build(
  runtime?: AgentKeyRuntime,
  keyId?: string,
  options?: { idempotencyMode?: "noop" | "throw-not-found" },
) {
  return createHardenedAgentsFacade(
    {
      requireSession: () => ({ accountId: "CWALLET", ...(keyId ? { keyId } : {}) }),
      runtime,
    },
    options,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #762: Duplicate contract IDs in a grant's policies array
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #762: duplicate policy contract ids in grant", () => {
  describe("assertNoDuplicatePolicies unit tests", () => {
    it("accepts a grant with unique policies", () => {
      expect(() =>
        assertNoDuplicatePolicies({ token: TOKEN, policies: [SPENDING, VERIFIED] }),
      ).not.toThrow();
    });

    it("rejects an empty policies array (no unrestricted grants)", () => {
      expect(() => assertNoDuplicatePolicies({ token: TOKEN, policies: [] })).toThrow(
        InvalidAgentInputError,
      );
      expect(() => assertNoDuplicatePolicies({ token: TOKEN, policies: [] })).toThrow(
        /has no policies — an unrestricted grant is not mintable/,
      );
    });

    it("rejects duplicate policies in the same grant", () => {
      expect(() =>
        assertNoDuplicatePolicies({ token: TOKEN, policies: [SPENDING, SPENDING] }),
      ).toThrow(InvalidAgentInputError);
      expect(() =>
        assertNoDuplicatePolicies({ token: TOKEN, policies: [SPENDING, SPENDING] }),
      ).toThrow(`grant for ${TOKEN} has duplicate policy: ${SPENDING}`);
    });

    it("rejects duplicate policies even when separated by another policy", () => {
      expect(() =>
        assertNoDuplicatePolicies({ token: TOKEN, policies: [SPENDING, VERIFIED, SPENDING] }),
      ).toThrow(`grant for ${TOKEN} has duplicate policy: ${SPENDING}`);
    });

    it("rejects malformed contract id before duplicate check", () => {
      expect(() =>
        assertNoDuplicatePolicies({ token: TOKEN, policies: ["INVALID_ID", "INVALID_ID"] }),
      ).toThrow(/policy must be a contract id/);
    });
  });

  describe("mint() integration with duplicate policy validation", () => {
    it("rejects a duplicate policy contract within one grant before any RPC or passkey prompt", async () => {
      const { runtime, addAgentKey, resume } = stubRuntime();
      const agents = build(runtime, "mykeyid");

      await expect(
        agents.mint({
          publicKey: AGENT_PK,
          grants: [{ token: TOKEN, policies: [SPENDING, SPENDING] }],
        }),
      ).rejects.toMatchObject({
        name: "InvalidAgentInputError",
        message: `grant for ${TOKEN} has duplicate policy: ${SPENDING}`,
      });

      expect(resume).not.toHaveBeenCalled();
      expect(addAgentKey).not.toHaveBeenCalled();
    });

    it("regression test: allows the same policy contract in grants for different tokens", async () => {
      const { runtime, addAgentKey } = stubRuntime();
      const agents = build(runtime);
      const grants = [
        { token: TOKEN, policies: [SPENDING] },
        { token: OTHER_TOKEN, policies: [SPENDING] },
      ];

      const result = await agents.mint({ publicKey: AGENT_PK, grants });

      expect(result).toEqual({ hash: "addhash", publicKey: AGENT_PK });
      expect(addAgentKey).toHaveBeenCalledWith({
        publicKey: AGENT_PK,
        grants,
        store: "persistent",
      });
    });

    it("allows multiple distinct policies in a single grant", async () => {
      const { runtime, addAgentKey } = stubRuntime();
      const agents = build(runtime);
      const grants = [{ token: TOKEN, policies: [SPENDING, VERIFIED] }];

      await agents.mint({ publicKey: AGENT_PK, grants });

      expect(addAgentKey).toHaveBeenCalledWith({
        publicKey: AGENT_PK,
        grants,
        store: "persistent",
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #763: mintAgentInput expiresAt accepting a Date/seconds in the past
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #763: past expiresAt rejection", () => {
  describe("validateExpiresAt unit tests", () => {
    const fixedNow = 1700000000000; // ms
    const fixedNowSec = 1700000000; // s

    it("returns undefined when expiresAt is undefined", () => {
      expect(validateExpiresAt(undefined, fixedNow)).toBeUndefined();
    });

    it("accepts a future Date", () => {
      const future = new Date(fixedNow + 10000);
      expect(validateExpiresAt(future, fixedNow)).toBe(fixedNowSec + 10);
    });

    it("accepts future unix seconds", () => {
      expect(validateExpiresAt(fixedNowSec + 3600, fixedNow)).toBe(fixedNowSec + 3600);
    });

    it("rejects a Date in the past", () => {
      const past = new Date(fixedNow - 1000);
      expect(() => validateExpiresAt(past, fixedNow)).toThrow(InvalidAgentInputError);
      expect(() => validateExpiresAt(past, fixedNow)).toThrow("expiresAt must be in the future");
    });

    it("rejects unix seconds in the past", () => {
      expect(() => validateExpiresAt(fixedNowSec - 60, fixedNow)).toThrow(
        InvalidAgentInputError,
      );
      expect(() => validateExpiresAt(fixedNowSec - 60, fixedNow)).toThrow(
        "expiresAt must be in the future",
      );
    });

    it("rejects timestamp exactly equal to current second", () => {
      expect(() => validateExpiresAt(fixedNowSec, fixedNow)).toThrow(InvalidAgentInputError);
      expect(() => validateExpiresAt(new Date(fixedNow), fixedNow)).toThrow(
        InvalidAgentInputError,
      );
    });

    it("rejects non-finite number values (NaN, Infinity)", () => {
      expect(() => validateExpiresAt(NaN, fixedNow)).toThrow(InvalidAgentInputError);
      expect(() => validateExpiresAt(Infinity, fixedNow)).toThrow(InvalidAgentInputError);
    });
  });

  describe("mint() integration with past expiresAt validation", () => {
    it.each([
      ["Date in the past", new Date(Date.now() - 5000)],
      ["unix seconds in the past", Math.floor(Date.now() / 1000) - 30],
      ["ancient Date", new Date("2020-01-01T00:00:00Z")],
    ])("rejects %s before any passkey prompt or RPC call", async (_label, pastExpiry) => {
      const { runtime, resume, addAgentKey } = stubRuntime();
      const agents = build(runtime, "mykeyid");

      await expect(
        agents.mint({
          publicKey: AGENT_PK,
          grants: [{ token: TOKEN, policies: [SPENDING] }],
          expiresAt: pastExpiry,
        }),
      ).rejects.toMatchObject({
        name: "InvalidAgentInputError",
        message: "expiresAt must be in the future",
      });

      // Crucial: No passkey prompt or RPC call was triggered
      expect(resume).not.toHaveBeenCalled();
      expect(addAgentKey).not.toHaveBeenCalled();
    });

    it("accepts a valid future Date and converts to ISO string", async () => {
      const { runtime, addAgentKey } = stubRuntime();
      const agents = build(runtime);
      const future = new Date(Date.now() + 3_600_000);

      const result = await agents.mint({
        publicKey: AGENT_PK,
        grants: [{ token: TOKEN, policies: [SPENDING] }],
        expiresAt: future,
      });

      const passedSeconds = addAgentKey.mock.calls[0]?.[0]?.expirationSeconds ?? 0;
      expect(passedSeconds).toBe(Math.floor(future.getTime() / 1000));
      expect(result.expiresAt).toBe(new Date(passedSeconds * 1000).toISOString());
    });

    it("accepts valid future unix seconds", async () => {
      const { runtime, addAgentKey } = stubRuntime();
      const agents = build(runtime);
      const futureSeconds = Math.floor(Date.now() / 1000) + 7200;

      await agents.mint({
        publicKey: AGENT_PK,
        grants: [{ token: TOKEN, policies: [SPENDING] }],
        expiresAt: futureSeconds,
      });

      expect(addAgentKey.mock.calls[0]?.[0]?.expirationSeconds).toBe(futureSeconds);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #765: Revoke idempotency against an already-revoked key
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #765: revoke idempotency against an already-revoked key", () => {
  it("succeeds as an idempotent no-op when called twice in succession (default mode)", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    const agents = build(runtime, undefined, { idempotencyMode: "noop" });

    // First call: succeeds on-chain
    const firstResult = await agents.revoke(AGENT_PK);
    expect(firstResult).toEqual({ hash: "rmhash" });
    expect(removeAgentKey).toHaveBeenCalledTimes(1);

    // Second call on the same key: succeeds as an idempotent no-op
    const secondResult = await agents.revoke(AGENT_PK);
    expect(secondResult).toEqual({ hash: "rmhash" });
    // Runtime was not called a second time because local facade tracks revocation
    expect(removeAgentKey).toHaveBeenCalledTimes(1);
  });

  it("throws clear AgentKeyNotFoundError when configured for explicit not-found mode", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    const agents = build(runtime, undefined, { idempotencyMode: "throw-not-found" });

    const firstResult = await agents.revoke(AGENT_PK);
    expect(firstResult).toEqual({ hash: "rmhash" });

    // Second call throws clear, named AgentKeyNotFoundError
    await expect(agents.revoke(AGENT_PK)).rejects.toThrow(AgentKeyNotFoundError);
    await expect(agents.revoke(AGENT_PK)).rejects.toMatchObject({
      name: "AgentKeyNotFoundError",
      publicKey: AGENT_PK,
      message: `Agent key not found or already revoked: ${AGENT_PK}`,
    });
    expect(removeAgentKey).toHaveBeenCalledTimes(1);
  });

  it("handles runtime throwing on-chain not-found error gracefully", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    removeAgentKey.mockRejectedValueOnce(
      new Error("Contract call failed: Key not found on-chain"),
    );

    const agents = build(runtime, undefined, { idempotencyMode: "noop" });

    // In no-op mode, on-chain already-revoked does not crash
    const res = await agents.revoke(AGENT_PK);
    expect(res).toEqual({ hash: "already-revoked" });
  });

  it("maps on-chain not-found error to AgentKeyNotFoundError in throw-not-found mode", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    removeAgentKey.mockRejectedValueOnce(
      new Error("Contract call failed: Key does not exist on-chain"),
    );

    const agents = build(runtime, undefined, { idempotencyMode: "throw-not-found" });

    await expect(agents.revoke(AGENT_PK)).rejects.toBeInstanceOf(AgentKeyNotFoundError);
  });

  it("re-throws unhandled runtime errors that are not not-found errors", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    removeAgentKey.mockRejectedValueOnce(new Error("RPC network connection timeout"));

    const agents = build(runtime);

    await expect(agents.revoke(AGENT_PK)).rejects.toThrow(
      "RPC network connection timeout",
    );
  });

  it("resumes passkey session before revoking when keyId is present", async () => {
    const { runtime, resume, removeAgentKey } = stubRuntime();
    const agents = build(runtime, "session-key-123");

    await agents.revoke(AGENT_PK);

    expect(resume).toHaveBeenCalledWith("session-key-123");
    expect(removeAgentKey).toHaveBeenCalledWith(AGENT_PK);
  });

  it("rejects an invalid public key format without calling runtime", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    const agents = build(runtime);

    await expect(agents.revoke("NOT_A_KEY")).rejects.toBeInstanceOf(InvalidAgentInputError);
    expect(removeAgentKey).not.toHaveBeenCalled();
  });

  it("throws AgentsNotConfiguredError when no runtime is provided", async () => {
    const agents = build(undefined);
    await expect(agents.revoke(AGENT_PK)).rejects.toBeInstanceOf(AgentsNotConfiguredError);
  });

  describe("revokeWithRetry caller retry helper", () => {
    it("resolves successfully when initial revoke succeeded on-chain before a timeout", async () => {
      const { runtime, removeAgentKey } = stubRuntime();
      // First attempt succeeds in runtime, but let's simulate retry in throw-not-found mode
      const agents = build(runtime, undefined, { idempotencyMode: "throw-not-found" });

      // First call succeeded
      await agents.revoke(AGENT_PK);

      // Now simulated retry call: receives AgentKeyNotFoundError and resolves as already-revoked
      const retryResult = await revokeWithRetry(agents, AGENT_PK);
      expect(retryResult.retried).toBe(true);
      expect(retryResult.hash).toBe("already-revoked");
    });
  });
});
