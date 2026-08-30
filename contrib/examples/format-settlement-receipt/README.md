# format-settlement-receipt

Formats an x402 settlement object into a readable receipt.

## Usage

```ts
import { formatSettlementReceipt } from "./index";

const receipt = formatSettlementReceipt({
  transaction: "aaa111...",
  payer: "CAAAA...",
  asset: "CAAAA...",
  amount: 1000000n,
  network: "testnet",
});

console.log(receipt.lines.join("\n"));
```

Output includes Transaction, Payer, Asset, Amount (human-readable plus base), and Network. Missing optional fields are omitted cleanly.