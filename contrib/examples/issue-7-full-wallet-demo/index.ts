/**
 * Reference example (issue #7): the full core flow — create, connect, pay,
 * and attach a spending-limit policy — through the real composed
 * `createVellarWallet` handle, using the TESTNET network config. All
 * dependencies (passkey kit, wallet backend, SAC client, policy API,
 * policy-attach runtime) are in-memory mocks, so this runs deterministically
 * with no live network call and no WebAuthn prompt.
 *
 * This ties together, in one script, what `full-create-connect`,
 * `full-payment-flow`, and `full-policy-flow` each demonstrate separately —
 * see those for a narrower look at each piece.
 *
 * A real integration replaces the mocks with:
 * - `kit`: a real `PasskeyKit` instance (runs the actual WebAuthn ceremony)
 * - `backend`: `createHttpWalletBackend(yourGatewayUrl)` — your server, which
 *   holds the relayer/sponsor secrets (the SDK never does)
 * - `sac`: a real `SACClient`
 * - policies: pass `apiUrl` pointed at your policy gateway, and a
 *   `policyAttach` runtime wired to `kit.addPolicy` (see the root README's
 *   "Policies" section)
 *
 * Run with:
 *   npx tsx index.ts
 */

import { createVellarWallet, type VellarWallet } from "../../../src/client";
import { createPolicyFacade, type PolicyAttachRuntime } from "../../../src/policy-facade";
import { TESTNET } from "../../../src/config";
import type { PasskeyKitLike, WalletBackend } from "../../../src/passkeykit-connector";
import type { SacClientLike, TokenContractClientLike } from "../../../src/payments-client";
import type { PolicyDefinition } from "../../../src/types";
import type { GeneratedPolicy, PolicyTemplateInfo, SimulateResult } from "../../../src/policy-types";

// ── in-memory mocks (no network, no WebAuthn) ──────────────────────────────

/** Shared "server" state so a second kit instance (simulating a fresh page
 * load) can resolve the same wallet by keyId, like a real backend would. */
function createMockBackend(): WalletBackend & {
  submitTransaction(input: { signedXdr: string; network: string }): Promise<{ hash: string }>;
} {
  const wallets = new Map<string, { contractId: string; sessionId: string }>();
  let nextHash = 1;
  return {
    async submitWalletCreation({ keyId, contractId }) {
      const sessionId = `sess-${wallets.size + 1}`;
      wallets.set(keyId, { contractId, sessionId });
      return { sessionId };
    },
    async lookupContractId({ keyId }) {
      return wallets.get(keyId);
    },
    async submitTransaction() {
      return { hash: `mockhash${nextHash++}`.padEnd(16, "0") };
    },
  };
}

function createMockKit(): PasskeyKitLike {
  return {
    wallet: undefined,
    async createWallet(_app, _user) {
      return { keyIdBase64: "mock-key-id", contractId: "C" + "A".repeat(55), signedTx: "mock-create-tx" };
    },
    async connectWallet(opts) {
      // Pretend the WebAuthn discovery ceremony resolved this credential (the
      // real kit does this internally); the connector supplies getContractId
      // to resolve it to a smart-account address via the backend.
      const keyId = "mock-key-id";
      const contractId = await opts?.getContractId?.(keyId);
      if (!contractId) throw new Error("no wallet found for this keyId");
      return { keyIdBase64: keyId, contractId };
    },
    async sign(tx) {
      return typeof tx === "string" ? `signed:${tx}` : "signed:mock-tx";
    },
  };
}

function createMockSac(): SacClientLike {
  return {
    getSACClient(tokenContractId: string): TokenContractClientLike {
      return {
        async transfer() {
          return `unsigned-transfer-tx:${tokenContractId}`;
        },
      };
    },
  };
}

const TEMPLATES: PolicyTemplateInfo[] = [
  {
    type: "spending_limit",
    title: "Daily spending limit",
    description: "Limits total outbound spend per rolling day.",
    enforcement: { kind: "policy-contract", wasmHash: "a".repeat(64) },
  },
];

/** A mock `fetch` implementing the policy gateway routes policy-client.ts
 * calls, so `createPolicyFacade` (the same building block `vellar.policies`
 * composes) can run its real request/response shapes with no network. */
function createMockPolicyFetch(): typeof fetch {
  const policies = new Map<string, GeneratedPolicy>();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (path === "/policies/templates") return json(TEMPLATES);

    if (path === "/policies/generate") {
      const definition = body.definition as PolicyDefinition;
      const id = `policy-${Date.now()}`;
      const policy: GeneratedPolicy = {
        id,
        createdAt: new Date().toISOString(),
        status: "generated",
        definition,
        policyHash: "b".repeat(64),
        manifest: { template: definition.type, enforcement: TEMPLATES[0]!.enforcement, network: "testnet" },
      };
      policies.set(id, policy);
      return json({ policy });
    }

    const simulateMatch = path.match(/^\/policies\/([^/]+)\/simulate$/);
    if (simulateMatch) {
      const result: SimulateResult = { ok: true, minResourceFee: "100000" };
      return json(result);
    }

    const deployInstanceMatch = path.match(/^\/policies\/([^/]+)\/deploy-instance$/);
    if (deployInstanceMatch) {
      return json({ contractId: `C${deployInstanceMatch[1]}`.padEnd(56, "X").slice(0, 56) });
    }

    if (path === "/policies/deploy") {
      const { policyId, txHash, contractId } = body as { policyId: string; txHash: string; contractId?: string };
      const existing = policies.get(policyId);
      if (!existing) return json({ error: `policy ${policyId} not generated` }, 404);
      const deployed: GeneratedPolicy = {
        ...existing,
        status: "deployed",
        deployment: { contractId, txHash, deployedAt: new Date().toISOString() },
      };
      policies.set(policyId, deployed);
      return json({ policy: deployed });
    }

    return json({ error: `no mock route for ${path}` }, 404);
  }) as typeof fetch;
}

// ── the demo ────────────────────────────────────────────────────────────────

export async function runFullWalletDemo(log: (line: string) => void = console.log): Promise<void> {
  const backend = createMockBackend();
  const sac = createMockSac();

  // 1. Create a wallet (registers a passkey + submits the deployment).
  const createKit = createMockKit();
  const vellar: VellarWallet = createVellarWallet({
    network: TESTNET.network,
    appName: "issue-7-full-wallet-demo",
    kit: createKit,
    backend,
    sac,
    isValidAddress: (address) => address.length > 0,
  });
  const created = await vellar.create({ username: "demo-user" });
  log(`1. create()  -> account ${created.accountId}`);

  // 2. Simulate a page reload: a fresh kit instance, same backend, reconnect
  //    by the persisted keyId (this is what `session.keyId` is for).
  const reconnectKit = createMockKit();
  const reconnected: VellarWallet = createVellarWallet({
    network: TESTNET.network,
    appName: "issue-7-full-wallet-demo",
    kit: reconnectKit,
    backend,
    sac,
    isValidAddress: (address) => address.length > 0,
  });
  const connected = await reconnected.connect();
  log(`2. connect() -> account ${connected.accountId} (same wallet, fresh session)`);

  // 3. Send a payment (builds + simulates, then signs and submits).
  const { hash } = await reconnected.pay({
    to: "C" + "B".repeat(55),
    amount: 5_0000000n, // 5 XLM, in stroops
    token: { contractId: TESTNET.nativeTokenContractId, symbol: "XLM", decimals: 7 },
  });
  log(`3. pay()     -> tx ${hash}`);

  // 4. Attach a spending-limit policy. `createPolicyFacade` is the same
  //    building block `vellar.policies` composes internally; used directly
  //    here so a mock `fetch` can be injected (the top-level facade doesn't
  //    expose that seam — see PolicyFacadeDeps).
  const attach: PolicyAttachRuntime = {
    async attachPolicy(policyContractId) {
      return { hash: `attach-${policyContractId}`.slice(0, 16) };
    },
  };
  const policies = createPolicyFacade({
    apiUrl: "https://mock-policy-api.test",
    network: TESTNET.network,
    requireSession: () => ({ accountId: connected.accountId }),
    attach,
    fetch: createMockPolicyFetch(),
  });

  const definition: PolicyDefinition = {
    version: "1",
    type: "spending_limit",
    owners: [connected.accountId],
    spendingLimits: { dailyXlm: "100" },
  };
  const generated = await policies.generate(definition);
  log(`4a. policies.generate() -> policy ${generated.id}`);
  const simulated = await policies.simulate(generated.id);
  log(`4b. policies.simulate() -> ok=${simulated.ok}`);
  const deployed = await policies.deploy(generated.id);
  log(`4c. policies.deploy()   -> attached, contract ${deployed.contractId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFullWalletDemo().catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
