# Wallet Methods

`createVellarWallet(config)` returns a `VellarWallet` handle — one per connected
user.

```ts
interface VellarWallet {
  readonly session: WalletSession | null;
  create(input?: { username?: string }): Promise<WalletSession>;
  connect(): Promise<WalletSession>;
  pay(input: PayInput): Promise<{ hash: string }>;
  receiveAddress(): string;
  paymentUri(options?: PaymentUriOptions): string;
  readonly policies: PolicyFacade;     // see Policies
  readonly connector: WalletConnector; // advanced
  readonly payments: PaymentClient;    // advanced
}
```

## `session`

The current `WalletSession`, or `null` before `create()` / `connect()`.

```ts
interface WalletSession {
  accountId: string;       // the "C..." smart-account address
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
  serverSessionId?: string; // your server's session record id
  keyId?: string;           // the passkey credential id (public) — persist for silent reconnect
}
```

## `create(input?)`

Registers a passkey and creates the smart account. **Prompts WebAuthn.** Returns
the new session.

```ts
const session = await vellar.create({ username: "alice" });
```

- `username` (optional) — shown in the passkey prompt.

## `connect()`

Reconnects with an existing passkey. Prompts WebAuthn — or resumes silently if
your host wired `keyId` resumption into the `kit` (persist `session.keyId` from a
previous create/connect, then pass it when constructing the kit).

```ts
const session = await vellar.connect();
```

## `pay(input)`

Builds and **simulates** the payment, then signs it with the passkey and submits
it (fee-sponsored). Simulation happens before the prompt, so failures surface
without asking the user to sign. Returns the network transaction hash.

```ts
const { hash } = await vellar.pay({
  to: "CDEST...",
  amount: 5_0000000n,
  token: { contractId, symbol: "XLM", decimals: 7 },
});
```

```ts
interface PayInput {
  to: string;        // recipient account or contract address
  amount: bigint;    // in the token's base units (e.g. stroops for XLM)
  token: {
    contractId: string;
    symbol: string;
    decimals: number;
  };
}
```

Throws `WalletNotReadyError` if called before `create()` / `connect()`, and
throws (before any signing) if `to` fails `isValidAddress`.

## `receiveAddress()`

Returns the connected account's address — ready to display, copy, or embed in
a QR code. Throws `WalletNotReadyError` before `create()` / `connect()`.

```ts
const address = vellar.receiveAddress(); // "C..."
```

## `paymentUri(options?)`

Builds a `web+stellar:pay` payment request URI addressed to the connected
account, so a payer's wallet can prefill the recipient and optionally the
amount/asset. Throws `WalletNotReadyError` before `create()` / `connect()`,
and `InvalidAmountError` / `InvalidAssetError` for a malformed `amount` /
`assetCode` / `assetIssuer` — never a broken URI.

```ts
const uri = vellar.paymentUri({ amount: "5", assetCode: "USDC", assetIssuer: "G..." });
// "web+stellar:pay?destination=C...&amount=5&asset_code=USDC&asset_issuer=G..."
```

```ts
interface PaymentUriOptions {
  amount?: string;       // decimal, e.g. "5" — not base units
  assetCode?: string;    // requires assetIssuer (omit both for native XLM)
  assetIssuer?: string;
  memo?: string;
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
}
```

> Vellar accounts are Soroban smart-wallet addresses (`C...`). SEP-0007's `pay`
> operation was written for classic (`G...`) destinations, so this URI is
> SEP-7-*shaped* but not a strict SEP-7 conformance claim — it's meant for
> Vellar-aware payers or QR display, the same way `vellar.pay()` itself sends
> via a SAC `transfer`, not a classic Payment operation.

## `policies`

Programmable on-chain account policies — list templates, generate artifacts,
simulate, and deploy (attach a policy with a single passkey signature). Requires
`apiUrl` in the config; `deploy` additionally requires a `policyAttach` runtime.
See [Policies](./policies.md).

## `connector` / `payments`

The lower-level building blocks the facade composes, exposed for flows beyond
the paved road. See [Advanced Usage](./advanced.md).
