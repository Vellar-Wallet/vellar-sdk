import { describe, expect, it, vi } from "vitest";
import {
  AgentsNotConfiguredError,
  InvalidAgentInputError,
  createAgentsFacade,
  type AgentKeyRuntime,
} from "./agents-facade";

const AGENT_PK = "G".padEnd(56, "A");
const TOKEN = "C".padEnd(56, "B");
const SPENDING = "C".padEnd(56, "C");
const VERIFIED = "C".padEnd(56, "D");

function stubRuntime() {
  const addAgentKey = vi.fn<AgentKeyRuntime["addAgentKey"]>(async () => ({ hash: "addhash" }));
  const removeAgentKey = vi.fn<AgentKeyRuntime["removeAgentKey"]>(async () => ({ hash: "rmhash" }));
  const resume = vi.fn<NonNullable<AgentKeyRuntime["resume"]>>(async () => {});
  const runtime: AgentKeyRuntime = { addAgentKey, removeAgentKey, resume };
  return { runtime, addAgentKey, removeAgentKey, resume };
}

function build(runtime?: AgentKeyRuntime, keyId?: string) {
  return createAgentsFacade({
    requireSession: () => ({ accountId: "CWALLET", ...(keyId ? { keyId } : {}) }),
    runtime,
  });
}

describe("wallet.agents.mint", () => {
  it("mints an agent key with the token grants and returns the hash", async () => {
    const { runtime, addAgentKey } = stubRuntime();
    const agents = build(runtime);
    const result = await agents.mint({
      publicKey: AGENT_PK,
      grants: [{ token: TOKEN, policies: [SPENDING, VERIFIED] }],
    });
    expect(result).toEqual({ hash: "addhash", publicKey: AGENT_PK });
    expect(addAgentKey).toHaveBeenCalledWith({
      publicKey: AGENT_PK,
      grants: [{ token: TOKEN, policies: [SPENDING, VERIFIED] }],
      store: "persistent",
    });
  });

  it("converts a Date expiry to unix seconds and echoes it back as ISO", async () => {
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

  it("accepts a raw unix-seconds expiry", async () => {
    const { runtime, addAgentKey } = stubRuntime();
    const agents = build(runtime);
    const seconds = Math.floor(Date.now() / 1000) + 7200;
    await agents.mint({
      publicKey: AGENT_PK,
      grants: [{ token: TOKEN, policies: [SPENDING] }],
      expiresAt: seconds,
    });
    expect(addAgentKey.mock.calls[0]?.[0]?.expirationSeconds).toBe(seconds);
  });

  it("resumes the passkey session before minting when a keyId is present", async () => {
    const { runtime, resume } = stubRuntime();
    const agents = build(runtime, "mykeyid");
    await agents.mint({ publicKey: AGENT_PK, grants: [{ token: TOKEN, policies: [SPENDING] }] });
    expect(resume).toHaveBeenCalledWith("mykeyid");
  });

  it("throws AgentsNotConfiguredError when no runtime is wired", async () => {
    const agents = build(undefined);
    await expect(
      agents.mint({ publicKey: AGENT_PK, grants: [{ token: TOKEN, policies: [SPENDING] }] }),
    ).rejects.toBeInstanceOf(AgentsNotConfiguredError);
  });

  it("rejects a bad agent public key", async () => {
    const { runtime } = stubRuntime();
    const agents = build(runtime);
    await expect(
      agents.mint({ publicKey: "not-a-key", grants: [{ token: TOKEN, policies: [SPENDING] }] }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);
  });

  it("rejects an empty grants list", async () => {
    const { runtime } = stubRuntime();
    const agents = build(runtime);
    await expect(agents.mint({ publicKey: AGENT_PK, grants: [] })).rejects.toBeInstanceOf(
      InvalidAgentInputError,
    );
  });

  it("rejects a grant with no policies (no unrestricted grants via wallet.agents)", async () => {
    const { runtime } = stubRuntime();
    const agents = build(runtime);
    await expect(
      agents.mint({ publicKey: AGENT_PK, grants: [{ token: TOKEN, policies: [] }] }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);
  });

  it("rejects a non-contract token or policy id", async () => {
    const { runtime } = stubRuntime();
    const agents = build(runtime);
    await expect(
      agents.mint({ publicKey: AGENT_PK, grants: [{ token: "GBAD", policies: [SPENDING] }] }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);
    await expect(
      agents.mint({ publicKey: AGENT_PK, grants: [{ token: TOKEN, policies: ["GBAD"] }] }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);
  });

  it("rejects an expiry in the past", async () => {
    const { runtime } = stubRuntime();
    const agents = build(runtime);
    await expect(
      agents.mint({
        publicKey: AGENT_PK,
        grants: [{ token: TOKEN, policies: [SPENDING] }],
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);
  });
});

describe("wallet.agents.revoke", () => {
  it("removes the agent key and returns the hash", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    const agents = build(runtime);
    const result = await agents.revoke(AGENT_PK);
    expect(result).toEqual({ hash: "rmhash" });
    expect(removeAgentKey).toHaveBeenCalledWith(AGENT_PK);
  });

  it("rejects a bad public key without calling the runtime", async () => {
    const { runtime, removeAgentKey } = stubRuntime();
    const agents = build(runtime);
    await expect(agents.revoke("nope")).rejects.toBeInstanceOf(InvalidAgentInputError);
    expect(removeAgentKey).not.toHaveBeenCalled();
  });

  it("throws AgentsNotConfiguredError when no runtime is wired", async () => {
    const agents = build(undefined);
    await expect(agents.revoke(AGENT_PK)).rejects.toBeInstanceOf(AgentsNotConfiguredError);
  });
});
