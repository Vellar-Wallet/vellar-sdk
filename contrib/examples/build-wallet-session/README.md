# Build WalletSession Example (#115)

Constructs a minimal sample `WalletSession` object by hand, validates that the provided `accountId` matches a Soroban contract address format, and outputs the resulting object as formatted JSON.

## WalletSession Shape

```typescript
interface WalletSession {
  /** The Soroban contract address of the wallet (must start with 'C' and be 56 characters long). */
  accountId: string;
  /** Optional session key or signer key identifier. */
  keyId?: string;
  /** ISO 8601 timestamp indicating when the session was created. */
  createdAt: string;
}
```

## Examples

| Account ID | Key ID | Valid Contract Address? | Output JSON |
| --- | --- | --- | --- |
| `CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D` | `undefined` | Yes | `{ "accountId": "CA7QY3...", "createdAt": "..." }` |
| `CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D` | `key-secp256r1-001` | Yes | `{ "accountId": "CA7QY3...", "keyId": "key-secp256r1-001", "createdAt": "..." }` |
| `GABC1234567890` | `undefined` | No | Throws Validation Error |

## Run it

```sh
npx tsx contrib/examples/build-wallet-session/build-wallet-session.ts
```

## Tests

```sh
npx vitest run contrib/examples/build-wallet-session
```
