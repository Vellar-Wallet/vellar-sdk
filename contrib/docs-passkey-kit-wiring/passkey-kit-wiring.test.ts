import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentsFacade, type AgentKeyRuntime } from "../../src/agents-facade";
import { resumeKitConnection } from "../../src/passkeykit-connector";

// Mirrors the reference wiring in
// passkey-kit-wiring.md against a fake kit,
// so the documented contract (which kit calls happen, in what order, and how
// failures propagate) is exercised by the hermetic suite.

const AGENT_PK = "G".padEnd(56, "A");
const TOKEN = "C".padEnd(56, "B");
const POLICY = "C".padEnd(56, "C");

function wire(overrides: { sign?: () => Promise<unknown>; submit?: () => Promise<{ hash: string }> } = {}) {
  const calls: string[] = [];
  const tx = { toXDR: () => "TXXDR" };
  const kit = {
    wallet: undefined as unknown,
    connectWallet: vi.fn(async () => {
      calls.push("connect");
    }),
    addEd25519: vi.fn(async () => {
      calls.push("add");
      return tx;
    }),
    remove: vi.fn(async () => {
      calls.push("remove");
      return tx;
    }),
    sign: vi.fn(overrides.sign ?? (async () => {
      calls.push("sign");
      return tx;
    })),
  };
  const submitTransaction = vi.fn(
    overrides.submit ??
      (async () => {
        calls.push("submit");
        return { hash: "HASH" };
      }),
  );
  const toXdr = (s: unknown) => (typeof s === "string" ? s : (s as { toXDR(): string }).toXDR());
  const submit = async (t: unknown) => {
    const signed = (await kit.sign()) ?? t;
    return submitTransaction({ signedXdr: toXdr(signed) } as never);
  };
  const runtime: AgentKeyRuntime = {
    resume: (keyId) => resumeKitConnection(kit, keyId),
    async addAgentKey({ publicKey, grants, expirationSeconds, store }) {
      const limits = new Map(grants.map((g) => [g.token, g.policies]));
      return submit(await kit.addEd25519(publicKey as never, limits as never, store as never, expirationSeconds as never));
    },
    removeAgentKey: async (publicKey) => submit(await kit.remove(publicKey as never)),
  };
  const agents = createAgentsFacade({
    requireSession: () => ({ accountId: "CWALLET", keyId: "key-1" }),
    runtime,
  });
  return { agents, kit, calls, submitTransaction };
}

describe("AgentKeyRuntime passkey-kit wiring", () => {
  it("mint: resumes, builds, signs once, then submits", async () => {
    const { agents, calls, submitTransaction } = wire();
    const res = await agents.mint({
      publicKey: AGENT_PK,
      grants: [{ token: TOKEN, policies: [POLICY] }],
    });
    expect(res.hash).toBe("HASH");
    expect(calls).toEqual(["connect", "add", "sign", "submit"]);
    expect(submitTransaction).toHaveBeenCalledWith(expect.objectContaining({ signedXdr: "TXXDR" }));
  });

  it("revoke: resumes, removes, signs once, then submits", async () => {
    const { agents, calls } = wire();
    const res = await agents.revoke(AGENT_PK);
    expect(res.hash).toBe("HASH");
    expect(calls).toEqual(["connect", "remove", "sign", "submit"]);
  });

  it("skips connect when the kit is already connected", async () => {
    const { agents, kit } = wire();
    kit.wallet = {};
    await agents.revoke(AGENT_PK);
    expect(kit.connectWallet).not.toHaveBeenCalled();
  });

  it("propagates a dismissed passkey prompt and submits nothing", async () => {
    const { agents, submitTransaction } = wire({
      sign: async () => {
        throw new Error("user cancelled");
      },
    });
    await expect(agents.revoke(AGENT_PK)).rejects.toThrow("user cancelled");
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("propagates a backend submission failure without returning a hash", async () => {
    const { agents } = wire({
      submit: async () => {
        throw new Error("relayer down");
      },
    });
    await expect(
      agents.mint({ publicKey: AGENT_PK, grants: [{ token: TOKEN, policies: [POLICY] }] }),
    ).rejects.toThrow("relayer down");
  });
});

describe("passkey-kit-wiring.md", () => {
  const md = readFileSync(path.join(__dirname, "passkey-kit-wiring.md"), "utf8");

  it("documents addAgentKey, removeAgentKey and the optional resume", () => {
    for (const name of ["addAgentKey", "removeAgentKey", "resume"]) {
      expect(md).toContain(name);
    }
  });

  it("resolves every relative .md link from agent-tooling/", () => {
    const dest = path.resolve(__dirname, "../../website/content/docs/agent-tooling");
    for (const m of md.matchAll(/\]\((\.{1,2}\/[^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      expect(existsSync(path.resolve(dest, m[1])), m[1]).toBe(true);
    }
  });
});
