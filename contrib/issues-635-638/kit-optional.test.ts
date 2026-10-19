import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet, WalletNotReadyError } from "../../src/client";
import { PolicyNotDeployableError } from "../../src/policy-facade";
import { AgentsNotConfiguredError } from "../../src/agents-facade";

// #638: with passkey-kit absent, the policies/agents facades must fail with
// named errors (never a raw "cannot read properties of undefined").

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const templates = [{ id: "spending-limit", name: "Spending limit" }];
const generated = { policyId: "pol-1" };
const simulated = { ok: true };
const CID = "CAFK7NMQOT7G2SKMREDUII3EOK4APIY54WIK6CVGY72XWFE76YFRDF67";
const mintInput = {
  publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  grants: [{ token: CID, policies: [CID] }],
};

function jsonFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("templates") ? templates : url.includes("simulate") ? simulated : generated;
    return new Response(JSON.stringify(url.includes("generate") ? { policy: body } : body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

// `kit` is a required type in VellarWalletConfig but optional peer at runtime.
function buildWithoutKit(extra: Record<string, unknown> = {}) {
  return createVellarWallet({
    network: "testnet",
    appName: "Test App",
    backend: {
      submitWalletCreation: vi.fn(),
      lookupContractId: vi.fn(),
      submitTransaction: vi.fn(),
    } as never,
    sac: { getSACClient: vi.fn() } as never,
    isValidAddress: () => true,
    apiUrl: "https://policy.example.test",
    ...extra,
  } as never);
}

function fakeKit() {
  return {
    createWallet: vi.fn(async () => ({ keyIdBase64: "k1", contractId: "CWALLET", signedTx: "xdr" })),
    connectWallet: vi.fn(async () => ({ keyIdBase64: "k1", contractId: "CWALLET" })),
    sign: vi.fn(async (tx: unknown) => tx),
    wallet: undefined,
  };
}

describe("createVellarWallet without a kit (#638)", () => {
  it("constructs without throwing", () => {
    expect(() => buildWithoutKit()).not.toThrow();
  });

  it("policies.deploy rejects with a named WalletNotReadyError, not a TypeError", async () => {
    const wallet = buildWithoutKit();
    const err = await wallet.policies.deploy("pol-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletNotReadyError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).name).toBe("WalletNotReadyError");
    expect((err as Error).message).toMatch(/create\(\) or connect\(\)/);
  });

  it("policies.listTemplates and generate still work without a kit", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);
    const wallet = buildWithoutKit();
    await expect(wallet.policies.listTemplates()).resolves.toEqual(templates);
    await expect(
      wallet.policies.generate({ version: "1", type: "spending_limit", owners: ["CAFK7NMQOT7G2SKMREDUII3EOK4APIY54WIK6CVGY72XWFE76YFRDF67"], spendingLimits: { dailyXlm: "100" } }),
    ).resolves.toEqual(generated);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("policies.simulate on the facade needs a connected wallet and throws WalletNotReadyError", () => {
    const wallet = buildWithoutKit();
    expect(() => wallet.policies.simulate("pol-1")).toThrow(WalletNotReadyError);
  });

  it("policies.client.simulate works without a kit or session", async () => {
    vi.stubGlobal("fetch", jsonFetch());
    const wallet = buildWithoutKit();
    await expect(wallet.policies.client.simulate("pol-1", "CWALLET")).resolves.toEqual(simulated);
  });

  it("wallet.policies without apiUrl throws WalletNotReadyError naming apiUrl", () => {
    const wallet = buildWithoutKit({ apiUrl: undefined });
    expect(() => wallet.policies).toThrow(WalletNotReadyError);
    expect(() => wallet.policies).toThrow(/apiUrl/);
  });

  it("agents.mint rejects with a named AgentsNotConfiguredError, not a TypeError", async () => {
    const wallet = buildWithoutKit();
    const err = await wallet.agents.mint(mintInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentsNotConfiguredError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(/agentKeys/);
  });
});

describe("runtime seams missing on a connected wallet (#638)", () => {
  async function connected(extra: Record<string, unknown> = {}) {
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      kit: fakeKit() as never,
      backend: {
        submitWalletCreation: vi.fn(async () => ({ sessionId: "s1" })),
        lookupContractId: vi.fn(async () => ({ contractId: "CWALLET", sessionId: "s2" })),
        submitTransaction: vi.fn(),
      } as never,
      sac: { getSACClient: vi.fn() } as never,
      isValidAddress: () => true,
      apiUrl: "https://policy.example.test",
      ...extra,
    });
    await wallet.connect();
    return wallet;
  }

  it("policies.deploy without policyAttach throws PolicyNotDeployableError", async () => {
    const wallet = await connected();
    const err = await wallet.policies.deploy("pol-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyNotDeployableError);
    expect((err as Error).name).toBe("PolicyNotDeployableError");
    expect((err as Error).message).toMatch(/policyAttach/);
  });

  it("agents.mint without agentKeys throws AgentsNotConfiguredError", async () => {
    const wallet = await connected();
    const err = await wallet.agents
      .mint(mintInput)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentsNotConfiguredError);
    expect((err as Error).message).toMatch(/agentKeys/);
  });

  it("agents.mint succeeds once an AgentKeyRuntime is wired", async () => {
    const addAgentKey = vi.fn(async () => ({ hash: "txhash" }));
    const wallet = await connected({ agentKeys: { addAgentKey, removeAgentKey: vi.fn() } });
    const out = await wallet.agents.mint(mintInput);
    expect(out.hash).toBe("txhash");
    expect(addAgentKey).toHaveBeenCalledOnce();
  });
});


