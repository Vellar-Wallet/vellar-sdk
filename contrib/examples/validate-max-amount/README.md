# validate-max-amount

Advisory helper that checks a proposed `maxAmount` against a mock price feed
and warns when the implied fiat value looks unreasonably high.

## Usage

```ts
import { validateMaxAmount } from "./index";

const result = validateMaxAmount({
  asset: "ETH",
  amount: 500_000_000_000n, // 50,000 ETH
});

if (result.warned) {
  console.warn(result.message);
}
```

## Example output

```
⚠️ maxAmount implies ~$150000000.00 USD, which is unusually high (asset=ETH).
```

## Notes

- This is a heuristic for UI/UX guidance only; it does not enforce on-chain limits.
- Default price feed contains USDC, ETH, BTC, XLM, CUSTOM_ASSET.
- Override `warningThreshold` or `assetDecimals` to tune sensitivity.