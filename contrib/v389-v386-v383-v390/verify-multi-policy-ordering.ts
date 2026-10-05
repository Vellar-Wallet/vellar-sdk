// Issue #386 — live testnet verification of comparePolicyAddresses' multi-
// policy ScVal ordering, run once to produce the result documented in this
// folder's README.md (and proposed as a code comment for
// src/x402-signer.ts's comparePolicyAddresses).
//
// WHY THIS EXISTS. `comparePolicyAddresses` (src/x402-signer.ts) sorts
// co-signer policy entries in the smart wallet signature map by raw address
// bytes. The existing unit test (src/x402-signer-policies.test.ts) only
// confirms INTERNAL self-consistency — a forward-configured policy list and a
// reversed one produce the same output order — which would pass even if raw-
// byte comparison were the WRONG rule, since it is at least consistent with
// itself. It does not establish that Soroban's host actually ACCEPTS that
// order. This script does: it deploys a fresh wallet governed by TWO real
// policy contracts, signs a payment with the SDK's own (unmodified)
// `createSessionKeySigner`, submits it, and reports whether the chain
// accepted it.
//
// This does not modify any file outside contrib/ — it drives the real,
// unmodified `src/x402-signer.ts` against live testnet infrastructure it
// deploys for itself.
//
// USAGE. Requires the `stellar` CLI (https://developers.stellar.org/docs/tools/developer-tools)
// configured with a `testnet` network, and three funded testnet identities:
//
//   stellar keys generate v386-source --network testnet --fund
//   stellar keys generate v386-admin  --network testnet
//   stellar keys generate v386-agent  --network testnet
//   stellar keys generate v386-recipient --network testnet --fund
//
// Then deploy the wallet (Ed25519 admin signer, unrestricted) and two
// `sample-policy` instances (passkey-kit's reference spending-limit policy;
// same wasm hash works for both — they're distinguished by deploy salt, i.e.
// by contract ADDRESS, which is all `comparePolicyAddresses` cares about):
//
//   stellar contract deploy --network testnet --source-account v386-source \
//     --wasm-hash 502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58 \
//     -- --signer '{"Ed25519":["<admin 32-byte pubkey hex>",[null],[null],"Persistent"]}'
//
//   stellar contract deploy --network testnet --source-account v386-source \
//     --wasm-hash 801b68fabf9f8746b10bfbc6d3da1b41462db0a38364ab8139d32dec3676ef39 \
//     --salt 000...0a   # policy A
//   stellar contract deploy --network testnet --source-account v386-source \
//     --wasm-hash 801b68fabf9f8746b10bfbc6d3da1b41462db0a38364ab8139d32dec3676ef39 \
//     --salt 000...0b   # policy B
//
// (`stellar keys public-key <alias>` prints the raw pubkey hex needed above.)
// Both wasm hashes are passkey-kit's own published canonical hashes — see
// this folder's README.md, issue #389 section, for how those are verified.
//
// Then:
//   V386_SOURCE_SECRET=$(stellar keys show v386-source) \
//   V386_ADMIN_SECRET=$(stellar keys show v386-admin) \
//   V386_AGENT_SECRET=$(stellar keys show v386-agent) \
//   V386_RECIPIENT=$(stellar keys address v386-recipient) \
//   V386_WALLET=<deployed wallet C-address> \
//   V386_POLICY_A=<deployed policy A C-address> \
//   V386_POLICY_B=<deployed policy B C-address> \
//   npx tsx contrib/v389-v386-v383-v390/verify-multi-policy-ordering.ts
//
// The already-executed run that produced this folder's README result used
// exactly this recipe.

import { Address, Keypair, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, KeypairSigner } from "@stellar/stellar-sdk/contract";
import { Client as WalletClient, type Signer as WalletSigner } from "passkey-kit-sdk";
import { createSessionKeySigner } from "../../src/x402-signer.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const WALLET = process.env.V386_WALLET!;
const POLICY_A = process.env.V386_POLICY_A!;
const POLICY_B = process.env.V386_POLICY_B!;
const SOURCE_SECRET = process.env.V386_SOURCE_SECRET!;
const ADMIN_SECRET = process.env.V386_ADMIN_SECRET!;
const AGENT_SECRET = process.env.V386_AGENT_SECRET!;
const RECIPIENT = process.env.V386_RECIPIENT!;

const source = Keypair.fromSecret(SOURCE_SECRET);
const server = new rpc.Server(RPC_URL);

function walletClient() {
  return new WalletClient({
    contractId: WALLET,
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: source.publicKey(),
    signTransaction: new KeypairSigner(source, PASSPHRASE),
  });
}

/** Sign the wallet's own auth entry with the unrestricted admin signer (no
 * policies needed) and submit. Mirrors x402-client.ts's buildSignedPayment. */
async function signAsAdminAndSend<T>(tx: AssembledTransaction<T>) {
  const built = tx.built;
  if (!built) throw new Error("not built");
  const op = built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  const auth = op.auth ?? [];
  const adminSigner = createSessionKeySigner({ address: WALLET, secretKey: ADMIN_SECRET });
  let signed = 0;
  for (let i = 0; i < auth.length; i++) {
    const entry = auth[i]!;
    if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (addr !== WALLET) continue;
    const latest = await server.getLatestLedger();
    const signedXdr = await adminSigner.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: latest.sequence + 100,
    });
    auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    signed++;
  }
  if (signed === 0) throw new Error("no wallet auth entry found to sign (admin)");
  op.auth = auth;
  await tx.simulate({ restore: false });
  return tx.signAndSend();
}

async function addSigner(label: string, signer: WalletSigner) {
  console.log(`\n== add_signer: ${label} ==`);
  const tx = await walletClient().add_signer({ signer });
  const sent = await signAsAdminAndSend(tx);
  console.log(label, "->", JSON.stringify(sent.result));
  return sent;
}

async function main() {
  // Register both policies (add_signer auto-invokes policy.install()).
  await addSigner("Policy A", {
    tag: "Policy",
    values: [POLICY_A, [undefined], [undefined], { tag: "Persistent", values: undefined }],
  });
  await addSigner("Policy B", {
    tag: "Policy",
    values: [POLICY_B, [undefined], [undefined], { tag: "Persistent", values: undefined }],
  });

  // Attach the agent Ed25519 signer, SignerLimits requiring BOTH policies on
  // the native SAC — the exact multi-policy shape comparePolicyAddresses sorts.
  const agent = Keypair.fromSecret(AGENT_SECRET);
  const limits = new Map([
    [
      NATIVE_SAC,
      [
        { tag: "Policy", values: [POLICY_A] },
        { tag: "Policy", values: [POLICY_B] },
      ],
    ],
  ]);
  await addSigner("Agent Ed25519 (SignerLimits: requires Policy A + Policy B on NATIVE_SAC)", {
    tag: "Ed25519",
    values: [agent.rawPublicKey(), [undefined], [limits as never], { tag: "Persistent", values: undefined }],
  });

  // Fund the wallet's native SAC balance from SOURCE (a classic G-account
  // invoking transfer as itself — ordinary account auth, no custom signature
  // map needed).
  console.log("\n== funding wallet's native balance ==");
  {
    const tx = await AssembledTransaction.build({
      contractId: NATIVE_SAC,
      method: "transfer",
      args: [
        nativeToScVal(source.publicKey(), { type: "address" }),
        nativeToScVal(WALLET, { type: "address" }),
        nativeToScVal(50_000_000n, { type: "i128" }),
      ],
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: source.publicKey(),
      signTransaction: new KeypairSigner(source, PASSPHRASE),
      parseResultXdr: (r: unknown) => r,
    });
    console.log("funded ->", JSON.stringify((await tx.signAndSend()).result));
  }

  // THE PROOF: transfer FROM the wallet, requiring the agent's Ed25519
  // signature PLUS both Policy(A) and Policy(B) entries in the signature map,
  // ordered by comparePolicyAddresses. Signed with the SDK's own
  // createSessionKeySigner (src/x402-signer.ts) — the real production code,
  // not a reimplementation.
  console.log("\n== multi-policy payment: transfer FROM the wallet ==");
  const payTx = await AssembledTransaction.build({
    contractId: NATIVE_SAC,
    method: "transfer",
    args: [
      nativeToScVal(WALLET, { type: "address" }),
      nativeToScVal(RECIPIENT, { type: "address" }),
      nativeToScVal(1_000_000n, { type: "i128" }),
    ],
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: source.publicKey(),
    parseResultXdr: (r: unknown) => r,
  });

  const built = payTx.built;
  if (!built) throw new Error("payment tx not built");
  const op = built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  const auth = op.auth ?? [];
  const agentSigner = createSessionKeySigner({
    address: WALLET,
    secretKey: AGENT_SECRET,
    policies: [POLICY_A, POLICY_B],
  });
  let signedCount = 0;
  for (let i = 0; i < auth.length; i++) {
    const entry = auth[i]!;
    if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (addr !== WALLET) continue;
    const latest = await server.getLatestLedger();
    const signedXdr = await agentSigner.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: latest.sequence + 100,
    });
    auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    signedCount++;

    const decoded = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    const map = decoded.credentials().address().signature().vec()![0]!.map()!;
    const order = map.map((e) => {
      const key = e.key();
      const variant = key.vec()![0]!.sym().toString();
      return variant === "Policy"
        ? `Policy(${Address.fromScVal(key.vec()![1]!).toString()})`
        : variant;
    });
    console.log("signature map order:", order.join(" -> "));
  }
  if (signedCount === 0) throw new Error("no wallet auth entry found to sign (agent)");
  op.auth = auth;

  await payTx.simulate({ restore: false });
  const settled = await payTx.signAndSend({ signTransaction: new KeypairSigner(source, PASSPHRASE) });
  console.log("PAYMENT RESULT ->", JSON.stringify(settled.result));
  console.log("PAYMENT TX HASH ->", settled.sendTransactionResponse?.hash);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
