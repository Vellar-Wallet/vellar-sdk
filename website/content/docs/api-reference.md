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

## Wallet activity

`createHttpWalletBackend()` also provides cursor-paginated transaction history
through the gateway's `GET /wallet/transactions` route. The current server
session id is required as a bearer capability and is sent in the authorization
header, never in the URL.

```ts
const backend = createHttpWalletBackend(apiUrl);
const session = await wallet.connect();
if (!session.serverSessionId) throw new Error("No server session is available");

const page = await backend.listActivity({
  accountId: session.accountId,
  network: session.network,
  bearerSessionId: session.serverSessionId,
  limit: 20,
});

// Continue with the opaque cursor; do not parse or construct it.
const olderPage = page.nextCursor
  ? await backend.listActivity({
      accountId: session.accountId,
      network: session.network,
      bearerSessionId: session.serverSessionId,
      limit: 20,
      after: page.nextCursor,
    })
  : undefined;
```

Each normalized entry includes `type`, `txHash`, and an ISO `timestamp`.
`counterparty`, `amount`, and `token` are optional when the recorded event has
those details. Empty history resolves to `{ entries: [], hasMore: false }`.

## React binding

React is an optional peer dependency and the binding is available from the
separate `vellar-sdk/react` entry, not the package root:

```tsx
import { VellarProvider, useWallet } from "vellar-sdk/react";

function ConnectButton() {
  const { session, connect, loading, error } = useWallet();
  return (
    <>
      <button disabled={loading} onClick={() => void connect()}>
        {session ? session.accountId : "Connect"}
      </button>
      {error instanceof Error && <p role="alert">{error.message}</p>}
    </>
  );
}

export function App() {
  return (
    <VellarProvider config={walletConfig}>
      <ConnectButton />
    </VellarProvider>
  );
}
```

`VellarProvider` takes the same configuration as `createVellarWallet()`.
`useWallet()` exposes `session`, `create`, `connect`, `pay`, `policies`,
`loading`, and `error`. It never invokes passkey actions automatically; the app
calls them from explicit user interactions.

## HTTP request controls

`createHttpWalletBackend()` uses a 10-second request timeout and retries
idempotent reads twice by default. It does not retry wallet creation or signed
transaction submission. Configure `timeoutMs` and `maxRetries` in its options;
each backend method accepts an optional `signal` for cancellation. A timed-out
request rejects with `WalletApiTimeoutError`.

## Returns

A [`VellarWallet`](./wallet-methods.md) handle.
