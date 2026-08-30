import { describe, expect, it, vi } from "vitest";
import { createPolicyReads } from "./policy-reads";
import { createPolicyWrites, PolicyNotDeployableError } from "./policy-writes";
import { createSplitPolicyFacade } from "./policy-facade-split";
import type {
  GeneratedPolicyLike,
  PolicyAttachRuntimeLike,
  PolicyClientLike,
} from "./policy-facade-types";

const ACCOUNT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const CONTRACT = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const TX_HASH = "1f0a6c621f0a6c631f0a6c641f0a6c651f0a6c661f0a6c671f0a6c681f0a6c69";

const policy = (over: Partial<GeneratedPolicyLike> = {}): GeneratedPolicyLike => ({
  id: "pol-1",
  status: "generated",
  ...over,
});

/** A client whose calls are all recorded, so ordering can be asserted. */
function mockClient(calls: string[] = [], over: Partial<PolicyClientLike> = {}) {
  const client: PolicyClientLike = {
    listTemplates: vi.fn(async () => {
      calls.push("listTemplates");
      return [{ id: "spend-limit" }];
    }),
    listPolicies: vi.fn(async () => {
      calls.push("listPolicies");
      return [policy()];
    }),
    validate: vi.fn(async () => {
      calls.push("validate");
      return { valid: true };
    }),
    generate: vi.fn(async () => {
      calls.push("generate");
      return policy();
    }),
    simulate: vi.fn(async () => {
      calls.push("simulate");
      return { cost: "100" };
    }),
    deployInstance: vi.fn(async () => {
      calls.push("deployInstance");
      return { contractId: CONTRACT };
    }),
    recordDeployment: vi.fn(async () => {
      calls.push("recordDeployment");
      return policy({ status: "deployed" });
    }),
    ...over,
  };
  return { client, calls };
}

function mockAttach(calls: string[] = []): PolicyAttachRuntimeLike {
  return {
    resume: vi.fn(async () => {
      calls.push("resume");
    }),
    attachPolicy: vi.fn(async () => {
      calls.push("attachPolicy");
      return { hash: TX_HASH };
    }),
  };
}

const session = (keyId?: string) => () => ({ accountId: ACCOUNT, ...(keyId ? { keyId } : {}) });

describe("policy-reads — no operation has a side effect", () => {
  it("listTemplates delegates to the client", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({ client, requireSession: session() });

    await expect(reads.listTemplates()).resolves.toEqual([{ id: "spend-limit" }]);
    expect(client.listTemplates).toHaveBeenCalledTimes(1);
  });

  it("validate delegates without generating or storing anything", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({ client, requireSession: session() });

    await expect(reads.validate({ kind: "spend-limit" })).resolves.toEqual({ valid: true });
    expect(client.validate).toHaveBeenCalledWith({ kind: "spend-limit" });
    // The distinction that keeps validate a read.
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("simulate binds the dry-run to the connected wallet's account id", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({ client, requireSession: session() });

    await reads.simulate("pol-1");

    expect(client.simulate).toHaveBeenCalledWith("pol-1", ACCOUNT);
  });

  it("simulate fails locally when no wallet is connected, before any request", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({
      client,
      requireSession: () => {
        throw new Error("not connected");
      },
    });

    await expect(reads.simulate("pol-1")).rejects.toThrow("not connected");
    expect(client.simulate).not.toHaveBeenCalled();
  });

  it("listPolicies forwards its filters", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({ client, requireSession: session() });

    await reads.listPolicies({ status: "active" });

    expect(client.listPolicies).toHaveBeenCalledWith({ status: "active" });
  });

  it("never touches a mutating client method", async () => {
    const { client } = mockClient();
    const reads = createPolicyReads({ client, requireSession: session() });

    await reads.listTemplates();
    await reads.validate({});
    await reads.simulate("pol-1");
    await reads.listPolicies();

    // The invariant the read module exists to guarantee.
    expect(client.generate).not.toHaveBeenCalled();
    expect(client.deployInstance).not.toHaveBeenCalled();
    expect(client.recordDeployment).not.toHaveBeenCalled();
  });

  it("is constructible without an attach runtime, because reads never prompt", () => {
    const { client } = mockClient();
    expect(() => createPolicyReads({ client, requireSession: session() })).not.toThrow();
  });
});

describe("policy-writes — generate", () => {
  it("delegates to the client", async () => {
    const { client } = mockClient();
    const writes = createPolicyWrites({ client, requireSession: session() });

    await expect(writes.generate({ kind: "spend-limit" })).resolves.toEqual(policy());
    expect(client.generate).toHaveBeenCalledWith({ kind: "spend-limit" });
  });

  it("is a write: the result carries a persisted status", async () => {
    const { client } = mockClient();
    const writes = createPolicyWrites({ client, requireSession: session() });

    const generated = await writes.generate({});

    // `status` is what distinguishes generate() from validate(): the gateway
    // persisted this, so calling twice creates two policies.
    expect(generated.status).toBe("generated");
  });
});

describe("policy-writes — deploy orchestration", () => {
  it("runs deploy-instance -> resume -> attach -> record, in that order", async () => {
    const calls: string[] = [];
    const { client } = mockClient(calls);
    const attach = mockAttach(calls);
    const writes = createPolicyWrites({ client, requireSession: session("key-1"), attach });

    const result = await writes.deploy("pol-1");

    // Ordering is a correctness property, not an implementation detail:
    // recording before attaching would mark a policy deployed that never
    // attached on-chain.
    expect(calls).toEqual(["deployInstance", "resume", "attachPolicy", "recordDeployment"]);
    expect(result).toEqual({
      policy: policy({ status: "deployed" }),
      contractId: CONTRACT,
      attachTxHash: TX_HASH,
    });
  });

  it("passes the wallet account to deploy-instance and the hash to record", async () => {
    const { client } = mockClient();
    const attach = mockAttach();
    const writes = createPolicyWrites({ client, requireSession: session("key-1"), attach });

    await writes.deploy("pol-1");

    expect(client.deployInstance).toHaveBeenCalledWith("pol-1", ACCOUNT);
    expect(attach.attachPolicy).toHaveBeenCalledWith(CONTRACT);
    expect(client.recordDeployment).toHaveBeenCalledWith("pol-1", TX_HASH, CONTRACT);
  });

  it("skips resume when the session has no keyId", async () => {
    const calls: string[] = [];
    const { client } = mockClient(calls);
    const attach = mockAttach(calls);
    const writes = createPolicyWrites({ client, requireSession: session(), attach });

    await writes.deploy("pol-1");

    expect(calls).toEqual(["deployInstance", "attachPolicy", "recordDeployment"]);
    expect(attach.resume).not.toHaveBeenCalled();
  });

  it("skips resume when the runtime does not implement it", async () => {
    const { client } = mockClient();
    const attach: PolicyAttachRuntimeLike = {
      attachPolicy: vi.fn(async () => ({ hash: TX_HASH })),
    };
    const writes = createPolicyWrites({ client, requireSession: session("key-1"), attach });

    await expect(writes.deploy("pol-1")).resolves.toBeDefined();
  });

  it("throws PolicyNotDeployableError when no attach runtime is configured", async () => {
    const { client } = mockClient();
    const writes = createPolicyWrites({ client, requireSession: session("key-1") });

    await expect(writes.deploy("pol-1")).rejects.toBeInstanceOf(PolicyNotDeployableError);
  });

  it("checks for the attach runtime BEFORE spending the sponsor's funds", async () => {
    const { client } = mockClient();
    const writes = createPolicyWrites({ client, requireSession: session("key-1") });

    await expect(writes.deploy("pol-1")).rejects.toBeInstanceOf(PolicyNotDeployableError);
    // A wallet that cannot finish the flow must not deploy an instance it can
    // never attach.
    expect(client.deployInstance).not.toHaveBeenCalled();
  });

  it("fails before deploying anything when no wallet is connected", async () => {
    const { client } = mockClient();
    const writes = createPolicyWrites({
      client,
      requireSession: () => {
        throw new Error("not connected");
      },
      attach: mockAttach(),
    });

    await expect(writes.deploy("pol-1")).rejects.toThrow("not connected");
    expect(client.deployInstance).not.toHaveBeenCalled();
  });

  it("does not record a deployment when the passkey prompt is declined", async () => {
    const { client } = mockClient();
    const attach: PolicyAttachRuntimeLike = {
      attachPolicy: vi.fn(async () => {
        throw new Error("user declined");
      }),
    };
    const writes = createPolicyWrites({ client, requireSession: session(), attach });

    await expect(writes.deploy("pol-1")).rejects.toThrow("user declined");
    // Nothing may be marked deployed when no signature was produced.
    expect(client.recordDeployment).not.toHaveBeenCalled();
  });

  it("surfaces a failed record without retrying the attach", async () => {
    const calls: string[] = [];
    const { client } = mockClient(calls, {
      recordDeployment: vi.fn(async () => {
        calls.push("recordDeployment");
        throw new Error("gateway down");
      }),
    });
    const attach = mockAttach(calls);
    const writes = createPolicyWrites({ client, requireSession: session(), attach });

    await expect(writes.deploy("pol-1")).rejects.toThrow("gateway down");
    // The attach already happened on-chain; a silent retry would deploy and
    // sign a second time. The caller reconciles instead.
    expect(attach.attachPolicy).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === "deployInstance")).toHaveLength(1);
  });
});

describe("createSplitPolicyFacade — parity with the unsplit facade", () => {
  it("exposes exactly the members the wallet handle expects", () => {
    const { client } = mockClient();
    const facade = createSplitPolicyFacade({ client, requireSession: session() });

    // The surface `src/policy-facade.ts` returns today, plus the reads the
    // client already supported.
    for (const member of ["listTemplates", "generate", "simulate", "deploy"] as const) {
      expect(typeof facade[member]).toBe("function");
    }
    expect(facade.client).toBe(client);
  });

  it("routes reads to the read half and writes to the write half", async () => {
    const calls: string[] = [];
    const { client } = mockClient(calls);
    const attach = mockAttach(calls);
    const facade = createSplitPolicyFacade({ client, requireSession: session("key-1"), attach });

    await facade.listTemplates();
    await facade.simulate("pol-1");
    await facade.generate({});
    await facade.deploy("pol-1");

    expect(calls).toEqual([
      "listTemplates",
      "simulate",
      "generate",
      "deployInstance",
      "resume",
      "attachPolicy",
      "recordDeployment",
    ]);
  });

  it("behaves identically to the unsplit facade for deploy", async () => {
    const { client } = mockClient();
    const attach = mockAttach();
    const facade = createSplitPolicyFacade({ client, requireSession: session("key-1"), attach });

    await expect(facade.deploy("pol-1")).resolves.toEqual({
      policy: policy({ status: "deployed" }),
      contractId: CONTRACT,
      attachTxHash: TX_HASH,
    });
  });

  it("still throws PolicyNotDeployableError through the composed facade", async () => {
    const { client } = mockClient();
    const facade = createSplitPolicyFacade({ client, requireSession: session("key-1") });

    await expect(facade.deploy("pol-1")).rejects.toBeInstanceOf(PolicyNotDeployableError);
  });

  it("shares one client between both halves", async () => {
    const { client } = mockClient();
    const facade = createSplitPolicyFacade({ client, requireSession: session() });

    await facade.listTemplates();
    await facade.generate({});

    expect(client.listTemplates).toHaveBeenCalledTimes(1);
    expect(client.generate).toHaveBeenCalledTimes(1);
  });
});
