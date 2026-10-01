import { createVellarWallet } from "../dist/index.js";
import { nativeToken } from "../dist/balances.js";
import { isValidStellarAddress } from "../dist/rpc.js";
import { selectRequirements } from "../dist/x402-guards.js";
import { renderUntrusted } from "../dist/x402-untrusted.js";

// Mock globals for browser WebAuthn context
globalThis.window = {};
globalThis.navigator = { credentials: {} };

async function run() {
  console.log("Starting pre-release smoke test (contrib)...");

  // 1. Verify balances export
  const token = nativeToken("Test SDF Network ; September 2015");
  if (!token || token.symbol !== "XLM" || token.decimals !== 7) {
    throw new Error("balances core export nativeToken failed");
  }

  // 2. Verify rpc export
  if (!isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")) {
    throw new Error("rpc core export isValidStellarAddress failed");
  }

  // 3. Verify x402-guards export
  const selected = selectRequirements({
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CASSET",
      amount: "100",
      payTo: "GPAYTO",
      maxTimeoutSeconds: 120,
      extra: { areFeesSponsored: true }
    }]
  }, { maxAmount: 1000n }, "stellar:testnet");
  if (selected.amount !== "100") {
    throw new Error("x402-guards core export selectRequirements failed");
  }

  // 4. Verify x402-untrusted export
  const fenced = renderUntrusted("label", "untrusted text");
  if (!fenced.includes("BEGIN UNTRUSTED RESOURCE DATA")) {
    throw new Error("x402-untrusted core export renderUntrusted failed");
  }

  // 5. Verify client creation and mock connection/payment flow
  const kit = {
    createWallet: async () => ({ keyIdBase64: "key123", contractId: "CWALLET", signedTx: "signed-deploy-xdr" }),
    connectWallet: async () => ({ keyIdBase64: "key123", contractId: "CWALLET" }),
    sign: async (tx) => tx,
    wallet: undefined,
  };

  const backend = {
    submitWalletCreation: async () => ({ sessionId: "sess-1" }),
    lookupContractId: async () => ({ contractId: "CWALLET", sessionId: "sess-2" }),
    submitTransaction: async () => ({ hash: "txhash-abc" }),
  };

  const transferSpy = [];
  const sac = {
    getSACClient: () => ({
      transfer: async (args, opts) => {
        transferSpy.push({ args, opts });
        return "built-transfer-xdr";
      }
    })
  };

  const wallet = createVellarWallet({
    network: "testnet",
    appName: "Smoke Test App",
    kit,
    backend,
    sac,
    isValidAddress: () => true,
  });

  if (wallet.session !== null) {
    throw new Error("Wallet should start with null session");
  }

  const session = await wallet.connect();
  if (session.accountId !== "CWALLET" || wallet.session !== session) {
    throw new Error("Wallet connect failed to set session");
  }

  const txRes = await wallet.pay({
    to: "GTO",
    amount: 1000n,
    token: { contractId: "CTOKEN", symbol: "USDC", decimals: 7 },
  });

  if (txRes.hash !== "txhash-abc") {
    throw new Error("Wallet pay failed to return transaction hash");
  }

  if (transferSpy.length !== 1 || transferSpy[0].args.amount !== 1000n) {
    throw new Error("Wallet pay did not execute transfer correctly");
  }

  console.log("Pre-release smoke test passed successfully!");
}

run().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
