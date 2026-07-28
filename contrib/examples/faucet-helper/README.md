# faucet-helper

Helper to request testnet funds from the public friendbot faucet.

## Usage

```ts
import { requestTestnetFunds, FaucetError } from "./index";

try {
  const result = await requestTestnetFunds("GACC");
  console.log(result.funded); // true
} catch (err) {
  console.error(err instanceof FaucetError ? err.message : err);
}
```

## Notes

- This only works against testnet.
- Throws `FaucetError` on non-200 responses.