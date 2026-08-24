# createVellarWallet

The single public entry point. Composes the passkey engine, token client, and
your backend into one wallet handle.

```ts
import { createVellarWallet } from "vellar-sdk";

const vellar = createVellarWallet(config);
```

## Config

```ts
interface VellarWalletConfig {
  network: "testnet" | "mainnet";
  appName: string;
  kit: PasskeyKit;
  sac: SACClient;
  backend: Backend;
  isValidAddress: (address: string) => boolean;
  signedToXdr?: (signed: unknown) => string;
  apiUrl?: string;
  policyAttach?: PolicyAttachRuntime;
  agentKeys?: AgentKeyRuntime;
  x402?: {
    signer: SmartAccountX402Signer;
    simulationSourceAccount: string;
    rpcUrl?: string;
    fetchImpl?: FetchLike;
    expirationLedgerOffset?: number;
  };
  rpcUrl?: string;
}
```

| Field | Type | Description |
| --- | --- | --- |
| `network` | `"testnet" \| "mainnet"` | Which Stellar network this client operates on. |
| `appName` | `string` | Display name shown in the platform passkey prompt (WebAuthn RP name). |
| `kit` | `PasskeyKit` | The passkey smart-wallet engine. Supplied by you so browser-only code isn't imported during SSR. |
| `sac` | `SACClient` | Soroban token client, used to build payment transfers. |
| `backend` | `Backend` | Your server endpoints for submission and lookup (holds relayer/sponsor secrets — never the SDK). |
| `isValidAddress` | `(address) => boolean` | Validates a recipient before a payment is ever signed. |
| `signedToXdr?` | `(signed) => string` | Advanced/test hook: convert the kit's signed output to XDR. Defaults to handling strings and objects with `toXDR()`. |
| `apiUrl?` | `string` | Policy API gateway base URL. Required to use `wallet.policies` — see [Policies](./policies.md#enabling-policies). |
| `policyAttach?` | `PolicyAttachRuntime` | Passkey-attach runtime for `wallet.policies.deploy()`; without it read/generate/simulate work but deploy throws. See [Policies](./policies.md#enabling-policies). |
| `agentKeys?` | `AgentKeyRuntime` | Passkey-signed wallet-admin runtime for `wallet.agents` (mint/revoke agent session keys). See [Agent Keys](./agent-keys.md). |
| `x402?` | `{ signer, simulationSourceAccount, rpcUrl?, fetchImpl?, expirationLedgerOffset? }` | Enables `wallet.x402` agentic payments. A valid RPC URL is required (here or top-level `rpcUrl`) — from 0.6.1, construction throws `X402NotConfiguredError` otherwise. See [x402](./x402.md#enabling-x402). |
| `rpcUrl?` | `string` | RPC URL for x402 simulation when `x402.rpcUrl` isn't given, e.g. `https://soroban-testnet.stellar.org`. |

<!-- TODO(docs): this page documents createVellarWallet's config only. Real,
     public exports still undocumented anywhere on the site — needs its own
     effort: waitForTransaction / TxStatusReader (tx-status), createSessionStore
     + storage adapters (session), the vellar-sdk/x402-guards subpath
     (decodePaymentRequired, selectRequirements, classifySettlement — the
     don't-double-pay retry classifier), assertAuthEntryInvocation
     (x402-auth-entry), the vellar-sdk/x402-untrusted prompt-injection
     sanitizers, and vellar-sdk/rpc (isValidStellarAddress,
     createRpcBalanceReader, createRpcTxStatusReader). -->

## The `backend` contract

```ts
interface Backend {
  submitWalletCreation(input: {
    keyId: string;
    contractId: string;
    network: "testnet" | "mainnet";
    signedTx: unknown;
  }): Promise<{ sessionId: string }>;

  lookupContractId(input: {
    keyId: string;
    network: "testnet" | "mainnet";
  }): Promise<{ contractId: string; sessionId: string } | undefined>;

  submitTransaction(input: {
    signedXdr: string;
    network: "testnet" | "mainnet";
  }): Promise<{ hash: string }>;
}
```

These forward to your server, which holds the relayer/sponsor credentials and
submits to the network. See [Installation](./installation.md) and
[How It Works](./how-it-works.md).

## Returns

A [`VellarWallet`](./wallet-methods.md) handle.
