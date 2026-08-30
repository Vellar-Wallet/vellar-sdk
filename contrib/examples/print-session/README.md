# Print a wallet session

Pretty-prints a `WalletSession` object's fields to the console with clear
labels, using a hardcoded sample session.

## The WalletSession shape

From `vellar-sdk`'s `src/types.ts`:

```ts
interface WalletSession {
  accountId: string;
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;   // ISO timestamp
  lastActiveAt: string; // ISO timestamp
  serverSessionId?: string; // present after a real create()/connect()
  keyId?: string;            // present after a real create()/connect()
}
```

`serverSessionId` and `keyId` are optional — printed as `(none)` when absent.

## Run it

```sh
npx tsx print-session.ts
```

## Tests

```sh
npx vitest run contrib/examples/print-session
```
