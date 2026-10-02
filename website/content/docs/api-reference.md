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
| `apiUrl?` | `string` | Policy API gateway base URL. Required to use `wallet.policies` — see [Policies](./agent-tooling/policies.md#enabling-policies). |
| `policyAttach?` | `PolicyAttachRuntime` | Passkey-attach runtime for `wallet.policies.deploy()`; without it read/generate/simulate work but deploy throws. See [Policies](./agent-tooling/policies.md#enabling-policies). |
| `agentKeys?` | `AgentKeyRuntime` | Passkey-signed wallet-admin runtime for `wallet.agents` (mint/revoke agent session keys). See [Agent Keys](./agent-tooling/agent-keys.md). |
| `x402?` | `{ signer, simulationSourceAccount, rpcUrl?, fetchImpl?, expirationLedgerOffset? }` | Enables `wallet.x402` agentic payments. A valid RPC URL is required (here or top-level `rpcUrl`) — from 0.6.1, construction throws `X402NotConfiguredError` otherwise. See [x402](./x402.md#enabling-x402). |
| `x402.expirationLedgerOffset?` | `number` | Number of ledgers added to the current ledger when setting auth entry expiration. Raise for flows with slow human confirmation; lower to shrink the replay window. See [Auth entry expiration](./x402.md#auth-entry-expiration). |
| `rpcUrl?` | `string` | RPC URL for x402 simulation when `x402.rpcUrl` isn't given, e.g. `https://soroban-testnet.stellar.org`. |

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
submits to the network. See [Installation](./getting-started/installation.md) and
[How It Works](./getting-started/how-it-works.md).

### Activity history

`createHttpWalletBackend` exposes a typed reader for the backend's
cursor-paginated `GET /wallet/transactions` route:

```ts
const page = await backend.listActivity({
  accountId: session.accountId,
  sessionId: session.serverSessionId!,
  network: session.network,
  limit: 20,
  cursor: previousPage.nextCursor,
});
```

The request must include the current `sessionId` bearer capability. The result
is normalized rather than returning the backend payload:

```ts
interface WalletActivityPage {
  items: WalletActivityItem[];
  hasMore: boolean;
  nextCursor?: string;
}

interface WalletActivityItem {
  id: string;
  type: string;
  counterparty?: string;
  amount?: string;
  token?: { contractId: string; symbol?: string; decimals?: number };
  transactionHash: string;
  timestamp: string;
}
```

`limit` defaults to 20. Treat `nextCursor` as opaque; when there is no
activity, `items` is empty and `hasMore` is false.

### HTTP request options

`createHttpWalletBackend(apiUrl, options)` accepts `timeoutMs` (default
30,000), `maxRetries` (default 2), `retryDelayMs` (default 200), and an optional
`signal`. A per-call `signal` can also be supplied to backend methods. Only
idempotent activity reads are retried; create, connect (which opens a server
session), and submit requests are never retried. Timeouts reject with
`WalletApiTimeoutError`.

### React binding

Install React as an application dependency and import the optional binding from
`vellar-sdk/react`:

```tsx
import { VellarProvider, useWallet } from "vellar-sdk/react";

function WalletPanel() {
  const { session, create, connect, pay, policies, loading, error } = useWallet();
  // Render actions and session state here.
}

root.render(
  <VellarProvider config={walletConfig}><WalletPanel /></VellarProvider>,
);
```

`VellarProvider` takes the same configuration as `createVellarWallet`. The hook
subscribes to session changes and exposes action loading/errors. Signing still
requires explicit user approval through the normal passkey prompt.

## Returns

A [`VellarWallet`](./wallet-methods.md) handle.
