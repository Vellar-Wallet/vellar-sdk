# Amount Input Validator

A self-contained example module that validates a raw string amount entered by
a user before it is converted to base units for a Vellar payment.

Contributed for [issue #58](https://github.com/Vellar-Wallet/vellar-sdk/issues/58).

---

## Overview

`amount-input-validator.ts` exports a single function:

```ts
function validateAmount(input: string, token: TokenConfig): ValidationResult
```

It returns a discriminated union — `{ valid: true, value }` or
`{ valid: false, code, message }` — so you can wire the result directly into a
form field's error state without any try/catch.

### Validation rules (in order)

| Rule | Code | Example bad input |
|---|---|---|
| Must not be empty | `EMPTY` | `""`, `"  "` |
| Must not be negative | `NEGATIVE` | `"-1"`, `"-0.5"` |
| Must be a valid decimal number | `NOT_NUMERIC` | `"abc"`, `"1,5"`, `"1e5"`, `"10."` |
| Must not exceed the token's decimal places | `TOO_MANY_DECIMALS` | `"1.00000001"` on a 7-decimal token |
| Must be greater than zero | `ZERO` | `"0"`, `"0.0000000"` |

The rules mirror `parseTokenAmount` in `src/payments.ts` so validation and
parsing are always consistent.

---

## Usage

### Basic form wiring

```ts
import { validateAmount } from "./amount-input-validator";

function onAmountChange(rawInput: string) {
  const result = validateAmount(rawInput, { decimals: 7, symbol: "XLM" });

  if (!result.valid) {
    setFieldError(result.message); // friendly string, safe to show in a <p>
    return;
  }

  clearFieldError();
  // result.value is the trimmed string — safe to pass to parseTokenAmount
  setAmountValue(result.value);
}
```

### Passing to `parseTokenAmount`

```ts
import { validateAmount } from "./amount-input-validator";
import { parseTokenAmount } from "vellar-sdk"; // or src/payments.ts

const result = validateAmount(rawInput, { decimals: 7 });
if (!result.valid) throw new Error(result.message);

// result.value is guaranteed valid — parseTokenAmount will not throw
const baseUnits = parseTokenAmount(result.value, 7);
```

### Token configs for common assets

```ts
// XLM (7 decimal places, stroops)
validateAmount(input, { decimals: 7, symbol: "XLM" });

// USDC (6 decimal places)
validateAmount(input, { decimals: 6, symbol: "USDC" });

// A whole-unit-only token
validateAmount(input, { decimals: 0, symbol: "POINTS" });
```

---

## Running the tests

The tests use [vitest](https://vitest.dev/), already a dev dependency of the repo.

```bash
# Run just this example's tests (from the repo root)
npx vitest run contrib/examples/issue-58-amount-input-validator/amount-input-validator.test.ts
```

Or run the full suite:

```bash
npm test
```

Expected output:

```
 ✓ contrib/examples/issue-58-amount-input-validator/amount-input-validator.test.ts (45)
   ✓ validateAmount — valid inputs (10)
   ✓ validateAmount — empty input (3)
   ✓ validateAmount — non-numeric input (9)
   ✓ validateAmount — negative input (4)
   ✓ validateAmount — zero input (5)
   ✓ validateAmount — too many decimal places (6)
   ✓ validateAmount — invalid token config (2)
   ✓ validateAmount — symbol in error messages (3)

 Test Files  1 passed (1)
 Tests       42 passed (42)
```

---

## File structure

```
contrib/examples/issue-58-amount-input-validator/
├── README.md                        ← you are here
├── amount-input-validator.ts        ← the module
└── amount-input-validator.test.ts   ← vitest tests
```
