# vellar-sdk

![Vellar](assets/vellar-banner.jpg)

**Passkey smart-wallet SDK for Stellar.** Add passkey login, a Soroban smart
account, and fee-sponsored payments to your app — without handling private keys,
seed phrases, or the low-level submission plumbing.

- **Passkeys, not seed phrases** — WebAuthn (Face ID / Touch ID / security
  keys). Keys live in the device's secure enclave and never leave it.
- **Smart-contract accounts** — each wallet is a Soroban smart wallet, so it
  can carry programmable policies (spending limits, multisig, allowlists).
- **Fee-sponsored** — users hold no XLM for fees; submission is sponsored
  server-side.
- **No key custody, no silent signing** — the SDK never holds secrets and
  never signs without an explicit passkey prompt.
- **Agentic payments (x402)** — pay HTTP-402 resources from the smart account
  with a scoped session key bounded by an on-chain budget: *give your agent a
  budget, not your keys.* See [x402](#x402).

> Status: early. Testnet-ready; mainnet use pending a security review. APIs may
> change before `1.0`.

**Full documentation: [docs.vellar.xyz](https://docs.vellar.xyz)** — guides,
API reference, wallet methods, policies, and the security model.

## Install

```sh
npm install vellar-sdk @stellar/stellar-sdk passkey-kit
```

`@stellar/stellar-sdk` is a required peer; `passkey-kit` is the passkey engine
you construct and pass in as `kit` (an optional peer of this package — the SDK
never imports it itself).

## Quick start

You supply three host pieces — a `PasskeyKit` engine, a Soroban token client,
and **your backend** — and the SDK composes them into one wallet handle. The SDK
ships the network config (`TESTNET`) and an HTTP backend client
(`createHttpWalletBackend`), so there's nothing to hand-wire.

```ts
import { PasskeyKit, SACClient } from "passkey-kit";
import {
  createVellarWallet,
  createHttpWalletBackend,
  TESTNET,
} from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit: new PasskeyKit({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
    walletWasmHash: TESTNET.walletWasmHash,
  }),
  sac: new SACClient({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  }),
  // Your backend (see "Your backend" below) — it holds the relayer/sponsor
  // secrets, the SDK never sees them. For testnet prototyping you can point at
  // the hosted gateway: https://vellar-backend.onrender.com (free instance,
  // first request after idle takes 30-90s, occasionally ~2min, to wake).
  backend: createHttpWalletBackend("https://api.myapp.com"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});

// Create a wallet (prompts the passkey once):
const session = await vellar.create({ username: "alice" });
console.log(session.accountId); // C... smart-account address

// …or reconnect an existing one:
await vellar.connect();

// Send a payment — builds + simulates, then prompts the passkey to sign:
const { hash } = await vellar.pay({
  to: "CDEST...",
  amount: 5_0000000n, // 5 XLM, in stroops
  token: {
    contractId: TESTNET.nativeTokenContractId, // XLM
    symbol: "XLM",
    decimals: 7,
  },
});
```

`pay()` simulates **before** the passkey prompt, so failures (e.g. insufficient
balance) surface without asking the user to sign.

## Your backend

Submission is fee-sponsored, which requires an OpenZeppelin Relayer API key and
a funded sponsor account. **These are secrets — they must live on your server,
never in the browser.** So the SDK never submits directly: it hands signed
transactions to your backend, which does the sponsored submit.

`createHttpWalletBackend(apiUrl)` speaks to a gateway exposing three routes:

| Route                  | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `POST /wallet/create`  | Submit the deployment tx; store keyId→contract |
| `POST /wallet/connect` | Resolve the smart-account for a known passkey  |
| `POST /wallet/submit`  | Submit an already-signed transaction           |

You run a backend implementing these (holding your relayer/sponsor creds). Your
backend must also allow your app's origin via CORS.

## API

### `createVellarWallet(config): VellarWallet`

Returns a `VellarWallet`:

| Member                       | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `session`                    | The current `WalletSession`, or `null` before create/connect |
| `create({ username? })`      | Register a passkey and create the smart account              |
| `connect()`                  | Reconnect with an existing passkey                           |
| `pay({ to, amount, token })` | Build → simulate → sign → submit; returns `{ hash }`         |
| `policies`                   | Programmable account policies — see [Policies](#policies)   |
| `x402`                       | Agentic payments — pay HTTP-402 resources — see [x402](#x402) |
| `connector` / `payments`     | Lower-level building blocks for custom flows                 |

### Helpers

| Export                         | Description                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `createHttpWalletBackend(url)` | An HTTP `backend` client for your gateway — pass straight to the config                  |
| `TESTNET`                      | Testnet config: `rpcUrl`, `networkPassphrase`, `walletWasmHash`, `nativeTokenContractId` |
| `MAINNET` / `mainnetConfig()`  | Mainnet config — see [Mainnet](#mainnet) (two values you must supply)                    |
| `WalletApiError`               | Thrown by the HTTP backend on non-2xx responses (has `status`, `code`)                   |

### Mainnet

> Mainnet use of this SDK is **pending a security review**. Shipping a mainnet
> config does not make mainnet blessed for production.

Two of the four network values cannot be shipped as constants and you must
supply them, so use `mainnetConfig()` rather than `MAINNET` directly:

```ts
import { mainnetConfig } from "vellar-sdk";

const network = mainnetConfig({
  // There is no free public SDF mainnet Soroban RPC — supply your provider.
  rpcUrl: "https://your-mainnet-soroban-rpc.example.com",
  // Verify this against the passkey-kit mainnet deployment manifest for YOUR
  // passkey-kit version. Do not copy the testnet hash on faith.
  walletWasmHash: "…64-char hex hash…",
});
```

`mainnetConfig()` fills the values that are known (the canonical mainnet
passphrase, SDF's public Horizon, and the XLM SAC id — derived and verified in
tests) and throws if `rpcUrl` or `walletWasmHash` is missing or malformed, so a
broken mainnet config can never be built silently. The bare `MAINNET` constant
has those two fields blank on purpose: a blank value fails loudly, a guessed one
fails silently.

### Policies

Attach programmable policies (e.g. an on-chain spending limit) to a wallet.
Pass `apiUrl` (your policy API gateway) in the config to enable
`wallet.policies`:

```ts
const templates = await vellar.policies.listTemplates();
const policy = await vellar.policies.generate(definition); // validate + artifacts
await vellar.policies.simulate(policy.id); // dry-run, no submit
const { contractId } = await vellar.policies.deploy(policy.id); // ONE passkey prompt
```

`deploy()` runs the full attach: your backend deploys the per-user policy
contract instance (sponsor-funded, server-side), the user passkey-signs
`addPolicy` to attach it — the only WebAuthn prompt, no silent signing — and
the completed attach is recorded. It requires a `policyAttach` runtime in the
config wired to your kit (`addPolicy` → sign → submit); without it, read,
generate, and simulate still work and `deploy()` throws a clear error.

Your gateway must expose the policy routes (`/policies/templates`,
`/policies/validate`, `/policies/generate`, `/policies/:id/simulate`,
`/policies/:id/deploy-instance`, `/policies/deploy`) — instance deploys are
funded by **your** sponsor account, server-side.

→ Full guide: [Policies on docs.vellar.xyz](https://docs.vellar.xyz/docs/policies).

### Agent keys

Mint scoped **agent session keys** — *give your agent a budget, not your keys.*
An agent key is a real on-chain signer restricted to specific tokens, each
requiring one or more **policy contracts** to co-sign inside the wallet's
`__check_auth`. Stack a spending-limit policy (how much) with a verified-only
policy (which contracts) and the chain enforces both — a compromised agent
holding the key cannot exceed the budget or pay through unverified code.

```ts
import { Keypair } from "@stellar/stellar-sdk";

const agentKey = Keypair.random(); // YOU hold the secret; the SDK never sees it

const { hash, expiresAt } = await vellar.agents.mint({
  publicKey: agentKey.publicKey(),
  grants: [{ token: usdcSac, policies: [spendingLimitId, verifiedOnlyId] }],
  expiresAt: new Date(Date.now() + 7 * 864e5), // optional on-chain expiry
});

// hand the agent its secret + the wallet address; it pays via wallet.x402
// under the on-chain budget — no passkey, no admin keys.

await vellar.agents.revoke(agentKey.publicKey()); // remote kill (passkey-signed)
```

`mint`/`revoke` are wallet-admin actions, so they need an `agentKeys` runtime
in the config wired to your kit (`addEd25519`/`remove` → passkey sign →
submit) — the only WebAuthn prompt. Without it these throw a clear error;
everything else on the wallet still works. Grants must name at least one
policy (an unrestricted grant is deliberately not mintable here).

→ Full guide: [Agent keys on docs.vellar.xyz](https://docs.vellar.xyz/docs/agent-keys).

### x402

Pay [x402](https://x402.org) (HTTP-402) resources from a Vellar smart account —
the "give your agent a budget, not your keys" flow. `wallet.x402.fetch()` handles
the 402 challenge transparently: it parses the payment requirements, builds and
signs the SEP-41 transfer as a smart-account auth entry, retries with the
`PAYMENT-SIGNATURE` header, and returns the unlocked response plus the on-chain
settlement.

Pass `x402` config with a **signer** (who pays) and a `simulationSourceAccount`
(any funded classic account, used only to simulate — the facilitator rebuilds the
transaction and pays the fee):

```ts
import { createVellarWallet, createSessionKeySigner } from "vellar-sdk";

const vellar = createVellarWallet({
  /* …network, appName, kit, backend, sac, isValidAddress… */
  x402: {
    // The agent flow: a scoped ed25519 session key signs headlessly.
    signer: createSessionKeySigner({ address: walletCAddress, secretKey: sessionKeySecret }),
    simulationSourceAccount: aFundedGAccount,
  },
});

const { response, paid, settlement } = await vellar.x402.fetch("https://api.example.com/paid", {
  maxAmount: 1_000_000n, // hard per-request ceiling in the asset's base units
  // allowedAssets: [usdcSac],   // optional — restrict which asset(s) you'll pay in
});

if (paid) console.log("settled on-chain:", settlement.transaction);
const data = await response.json(); // the unlocked resource
```

Two signers ship, both satisfying the same `SmartAccountX402Signer` interface:

| Signer | Flow |
| ------ | ---- |
| `createSessionKeySigner({ address, secretKey })` | **Agent** — an ed25519 session key signs headlessly (no passkey prompt). Its authority is bounded on-chain by the spending-limit policy attached to it. |
| `createPasskeyX402Signer({ address, webAuthn })` | **Human** — one passkey prompt per payment. `webAuthn` is a small seam you wire to your passkey ceremony (keeps this SDK free of a passkey-kit dependency). |

> **`maxAmount` is a client-side guard, not the budget.** It stops an
> over-charging server before anything is signed. The durable, enforced budget is
> the **on-chain spending-limit policy** attached to the signing key — for a
> per-token budget, use the token-scoped policy so only that token's transfers
> count. The SDK refuses to sign above `maxAmount`; the chain refuses to settle
> above the policy cap.

Errors are typed: `MaxAmountExceededError`, `DisallowedAssetError`,
`NoUsablePaymentOptionError`, `InvalidRequirementsError`, `PaymentRejectedError`
(the facilitator rejected it — e.g. an over-budget payment blocked by the policy),
and `X402NotConfiguredError` (no `x402` config). Lower-level: `createX402Client`
for a client without the wallet handle.

> **Facilitator note:** a policy-governed payment runs the policy inside
> `__check_auth`, which costs more resource fee than a plain transfer. Hosted
> facilitators cap the fee they sponsor (x402.org's default is 50,000 stroops),
> so a policy-governed payment needs a facilitator configured with a higher
> ceiling (self-hosted, or a hosted one that allows it).

#### Security: signed requests to the facilitator

The payment payload itself is already signed (the smart-wallet auth entry).
That proves the **payment** is authentic; it says nothing about the **HTTP
request** that carries it. Pass `requestSigning` in `x402` config to also
sign every outgoing facilitator request with HMAC-SHA256 over a canonical
string (method, path, timestamp, nonce, body), using a shared secret
provisioned out of band with your facilitator operator:

```ts
const vellar = createVellarWallet({
  x402: {
    signer: createSessionKeySigner({ address: walletCAddress, secretKey: sessionKeySecret }),
    simulationSourceAccount: aFundedGAccount,
    requestSigning: { keyId: "your-key-id", secret: process.env.VELLAR_FACILITATOR_SECRET! },
  },
});
```

This is **opt-in** and additive — a facilitator that doesn't verify the
`X-Vellar-*` headers is unaffected either way, and it does not replace TLS.
`vellar-sdk/x402-request-auth` also exports `verifyFacilitatorRequest` so a
facilitator implemented in TypeScript can share the exact same canonical-string
logic rather than reimplementing it and risking drift. See the module's
doc comments for what this does and does not cover (it authenticates the
*request*, not the on-chain payment, which the auth-entry signature already
covers, and not the facilitator's response).

#### Capability scoping for signers

A session key or passkey signer will sign **any** auth entry addressed to its
wallet once `x402-client.ts` has confirmed it matches the payment being made.
Two callers sharing one session key (a multi-tenant agent process, or a signer
reused across unrelated call sites) have no narrower guard than "everything
this wallet can do." Pass `capabilities` to either signer to add one:

```ts
import { createSessionKeySigner } from "vellar-sdk";

const signer = createSessionKeySigner({
  address: walletCAddress,
  secretKey: sessionKeySecret,
  // This key will only ever sign a `transfer` call on `usdcSac` — anything
  // else throws CapabilityDeniedError before a signature is produced.
  capabilities: [{ resourceType: usdcSac, action: "transfer" }],
});
```

Rules match on resource (contract) and action (function name); either field
accepts `"*"` for a wildcard. An empty/omitted `capabilities` array is fully
backward compatible — the signer signs anything it always did. This is a
**client-side** guard, checked in this process before signing — it narrows
what the SDK will attempt, but the on-chain `SignerLimits`/Policy mechanism
(see [Agent keys](#agent-keys)) is still the only check a compromised host
process can't bypass. See `src/x402-signer-capabilities.ts`'s doc comments for
the full scope of what this does and does not guarantee.

#### Attribute-based session key budgets

`maxAmount` and the on-chain spending-limit policy bound a session key's
*total* spend, but neither knows about *who* it's paying. Pass
`budgetAttributes` in `x402` config to scope the budget by merchant, category,
and/or time window, checked before a payment is even built:

```ts
const vellar = createVellarWallet({
  x402: {
    signer: createSessionKeySigner({ address: walletCAddress, secretKey: sessionKeySecret }),
    simulationSourceAccount: aFundedGAccount,
    budgetAttributes: [
      // Up to 5 USDC per payment to this merchant, any time.
      { merchant: knownMerchantAddress, maxAmount: 50_000_000n },
      // Groceries only, business hours UTC, capped at 20 USDC total per period.
      {
        merchant: "*",
        category: "groceries",
        maxAmount: 20_000_000n,
        periodMaxAmount: 200_000_000n,
        window: { startHourUtc: 9, endHourUtc: 17 },
      },
    ],
  },
});
```

`category` is read from the server's `PAYMENT-REQUIRED` response
(`extra.category`) — this SDK doesn't define categories, your
facilitator/resource server does. `periodMaxAmount` needs a
`budgetAttributeTracker` to accumulate spend across calls; the SDK supplies an
in-memory one automatically when you set `periodMaxAmount` without providing
your own (process-lifetime only — bring your own tracker for anything that
must persist or be shared). A request matching no rule, or exceeding the
matching rule's ceiling, throws `BudgetAttributeDeniedError` before signing.
Like capability scoping, this is a **client-side** narrowing on top of (never
instead of) the on-chain policy — see `src/x402-budget-attributes.ts`'s doc
comments for the full scope.

### Advanced

The facade is the paved road. For custom flows the package also exports the
underlying pieces: `createPasskeyKitConnector`, `createPaymentClient`,
`createSessionStore`, `createX402Client` (x402 without the wallet handle) and its
signers (`createSessionKeySigner`, `createPasskeyX402Signer`), the
`WalletConnector` interface, balances helpers (`vellar-sdk/balances`), a
`redactSensitiveFields` helper for logging hooks (see
[Redacting sensitive fields in logging hooks](#security-redacting-sensitive-fields-in-logging-hooks)),
and RPC-backed readers (`vellar-sdk/rpc`, imported separately so
`@stellar/stellar-sdk` stays out of bundles that don't read balances).

#### Session key rotation on re-authentication

`createPasskeyKitConnector` accepts an optional `sessionKeyRotation` runtime:
when set, every successful `connectWallet` (re-authentication) mints a fresh
agent session key and revokes whichever key rotation last minted for that
wallet, so a stale key from a previous session doesn't stay valid indefinitely.

```ts
import { createPasskeyKitConnector } from "vellar-sdk";

const connector = createPasskeyKitConnector({
  kit,
  backend,
  network: "testnet",
  appName: "Vellar",
  sessionKeyRotation: {
    async mint() {
      // Wire to the same passkey-signed admin plumbing wallet.agents.mint uses.
      const key = Keypair.random();
      await vellar.agents.mint({ publicKey: key.publicKey(), grants: [...] });
      return { publicKey: key.publicKey() };
    },
    async revoke(publicKey) {
      await vellar.agents.revoke(publicKey);
    },
  },
  onDebugLog: (event, details) => console.debug(`[vellar] ${event}`, details),
});
```

Rotation is best-effort and never blocks re-authentication: a mint or revoke
failure is reported to `onDebugLog` (default: a no-op — bring your own logger)
rather than thrown, and mint always runs before revoke so a revoke failure
never leaves the wallet with no valid session key. Omit `sessionKeyRotation`
for the pre-existing behaviour (no rotation).

#### Security: redacting sensitive fields in logging hooks

`onDebugLog` (above) and any other place this SDK hands a structured object to
a hook you supplied is designed to be piped straight into your own
logger/telemetry pipeline — this SDK never logs anything on its own. Those
objects can carry fields that identify a specific user or wallet: an ed25519
session-key public key, the smart-account contract id, a WebAuthn credential
id (`WalletSession.keyId`), or a server-side session id. None of these are
secrets this SDK holds (it never has a wallet private key to log), but they
are stable, wallet-linkable identifiers that a downstream log aggregator,
support export, or analytics sink generally should not retain in plaintext.

`redactSensitiveFields` replaces every field matching a known-sensitive name
(`secretKey`, `secret`, `privateKey`, `publicKey`, `previousPublicKey`,
`newPublicKey`, `accountId`, `contractId`, `keyId`, `sessionId`,
`serverSessionId`, `signature` — see `SENSITIVE_LOG_FIELDS`) with `"[redacted]"`,
walking nested objects and arrays, before you hand the result to your logger:

```ts
import { createPasskeyKitConnector, redactSensitiveFields } from "vellar-sdk";

const connector = createPasskeyKitConnector({
  kit,
  backend,
  network: "testnet",
  appName: "Vellar",
  onDebugLog: (event, details) => myLogger.debug(event, redactSensitiveFields(details)),
});
```

This is an **opt-in helper**, not a change to what the SDK passes to your
hook by default — wiring it is your call, so tests and pipelines that already
inspect real values are unaffected unless you choose to wrap the hook. Pass
`extraFields` to also redact fields specific to your own `details` payloads
(e.g. an email address your app adds before re-logging):

```ts
redactSensitiveFields(details, { extraFields: ["email", "phoneNumber"] });
```

`redactSensitiveFields` is a pure function over plain data: it does not
serialize, and non-plain values (`Error`, `Date`, class instances, XDR/`ScVal`
objects) pass through untouched rather than being flattened into `{}`.
## API stability

Exports fall into two groups:

| Group | Import | Guarantee |
| --- | --- | --- |
| **Stable v1** | `import { createVellarWallet, TESTNET, … } from "vellar-sdk"` | Breaking changes only in major semver releases (until `2.0`). |
| **Experimental** | `import { experimental } from "vellar-sdk"` then `experimental.createX402Client`, etc. | May change in any release — x402, agentic payments, and related helpers. |

The stable v1 surface covers the wallet facade, config, backend client, balances,
payments, policies, agent keys, session store, and transaction status helpers.
Experimental symbols are also re-exported flat at the package root for backward
compatibility; treat those flat imports as unstable.

The canonical export lists live in `src/export-surface.ts` and are checked by
`src/index.exports.test.ts`.

## License

Apache-2.0
