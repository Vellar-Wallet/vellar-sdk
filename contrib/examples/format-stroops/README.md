# format-stroops

Converts a raw stroops amount into a human readable XLM string with up to 7
decimal places, using `BigInt` so large balances don't lose precision.

## Usage

```ts
import { formatStroops } from "./format-stroops";

formatStroops(10_000_000n); // "1"
```

Or run it as a script:

```sh
npx tsx format-stroops.ts 10000000
```

## API

```ts
function formatStroops(stroops: bigint | number | string): string;
```

Trailing zero decimal digits are trimmed, and a whole-XLM amount is returned
without a decimal point.

## Examples

| Input (stroops) | Output       |
| ---------------- | ------------ |
| `0`               | `0`          |
| `1`               | `0.0000001`  |
| `100000`          | `0.01`       |
| `10000000`        | `1`          |
| `123456789`       | `12.3456789` |
| `9999999999999999` | `999999999.9999999` |
