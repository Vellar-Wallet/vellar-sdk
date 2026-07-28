// Runnable example: create, connect, pay, and attach a spending-limit policy
// with vellar-sdk on testnet. Imports ONLY the published package surface
// ("vellar-sdk") — nothing from the SDK's internal src/.
//
// Prerequisites: see README.md in this directory. In short, you need a
// backend gateway implementing the /wallet/* (and, for the policy step,
// /policies/*) routes documented in the root README's "Your backend"
// section — the SDK never holds relayer/sponsor secrets itself.

import { PasskeyKit, SACClient, SignerStore } from "passkey-kit";
import {
  createVellarWallet,
  createHttpWalletBackend,
  TESTNET,
  type PolicyAttachRuntime,
  type PolicyDefinition,
} from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

// --- Edit these for your setup (see README.md) ---
const BACKEND_URL = "http://localhost:8787"; // your /wallet/* gateway
const POLICY_API_URL = "http://localhost:8787"; // your /policies/* gateway (often the same host)
const APP_NAME = "vellar-sdk example";
// ---------------------------------------------------

const kit = new PasskeyKit({
  rpcUrl: TESTNET.rpcUrl,
  networkPassphrase: TESTNET.networkPassphrase,
  walletWasmHash: TESTNET.walletWasmHash,
});

const backend = createHttpWalletBackend(BACKEND_URL);

// Attaching a policy needs one extra capability beyond the core WalletConnector:
// kit.addPolicy(contractId) -> passkey-sign -> backend.submitTransaction. This
// mirrors the wiring documented on `PolicyFacadeDeps`/`PolicyAttachRuntime` in
// vellar-sdk (kept as a narrow seam so the core kit type doesn't need it).
const policyAttach: PolicyAttachRuntime = {
  async attachPolicy(policyContractId) {
    // No extra SignerLimits scoping beyond what the policy contract itself
    // enforces; Persistent so the attach survives across sessions.
    const tx = await kit.addPolicy(policyContractId, undefined, SignerStore.Persistent);
    const signed = await kit.sign(tx);
    const signedXdr = typeof signed === "string" ? signed : (signed as { toXDR(): string }).toXDR();
    return backend.submitTransaction({ signedXdr, network: "testnet" });
  },
};

const vellar = createVellarWallet({
  network: "testnet",
  appName: APP_NAME,
  kit,
  sac: new SACClient({ rpcUrl: TESTNET.rpcUrl, networkPassphrase: TESTNET.networkPassphrase }),
  backend,
  isValidAddress: (a) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
  apiUrl: POLICY_API_URL,
  policyAttach,
});

const logEl = document.getElementById("log") as HTMLPreElement;
function log(message: string): void {
  console.log(message);
  logEl.textContent = `${logEl.textContent}\n${message}`;
}

async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    log(`\n> ${label}…`);
    const result = await fn();
    log(`✓ ${label}: ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  } catch (err) {
    // Every failure is a typed VellarError subclass — see the SDK's Errors docs.
    log(`✗ ${label} failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
}

document.getElementById("create")!.addEventListener("click", () =>
  run("create()", async () => {
    const session = await vellar.create({ username: "example-user" });
    return { accountId: session.accountId };
  }),
);

document.getElementById("connect")!.addEventListener("click", () =>
  run("connect()", async () => {
    const session = await vellar.connect();
    return { accountId: session.accountId };
  }),
);

document.getElementById("pay")!.addEventListener("click", () =>
  run("pay()", async () => {
    const to = window.prompt("Recipient address (G... or C...)");
    if (!to) throw new Error("cancelled");
    return vellar.pay({
      to,
      amount: 1_0000000n, // 1 XLM, in stroops
      token: { contractId: TESTNET.nativeTokenContractId, symbol: "XLM", decimals: 7 },
    });
  }),
);

document.getElementById("attach-policy")!.addEventListener("click", () =>
  run("policies.deploy()", async () => {
    if (!vellar.session) throw new Error("connect or create a wallet first");
    const definition: PolicyDefinition = {
      version: "1",
      type: "spending_limit",
      owners: [vellar.session.accountId],
      spendingLimits: { dailyXlm: "100" },
    };
    const policy = await vellar.policies.generate(definition);
    await vellar.policies.simulate(policy.id);
    return vellar.policies.deploy(policy.id); // the one passkey prompt for the attach
  }),
);
