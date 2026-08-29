# format-signer-list

Formats an array of signer records into a readable list sorted by weight
descending.

## Usage

```ts
import { formatSignerList } from "./index";

const signers = [
  { key: "GAAAA", type: "ed25519", weight: 1 },
  { key: "GZZZZZ", type: "ed25519", weight: 5 },
];

const result = formatSignerList(signers);
console.log(result.lines.join("\n"));
// 1. ed25519 key GZZZZZ (weight 5)
// 2. ed25519 key GAAAA (weight 1)