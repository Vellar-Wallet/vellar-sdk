# Validate x402 allowed assets

This small example validates a list of Stellar contract IDs before passing it
as an x402 client `allowedAssets` setting. It returns every invalid entry so a
configuration can be fixed in one pass rather than failing at the first value.

An empty array is valid and means no allow-list restriction is configured.

```ts
import { validateAllowedAssets } from "./validate-allowed-assets";

const invalid = validateAllowedAssets([
  "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG",
  "not-a-contract-id",
]);

if (invalid.length > 0) {
  console.error(invalid);
}
```

Each entry is checked for the `C` prefix, the 56-character contract-ID length,
and a valid Stellar StrKey checksum.