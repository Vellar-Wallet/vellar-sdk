# Issue #264: Add unit tests for policy-types schema validation

## Contributor Sandbox

This file demonstrates unit tests for policy-types schema validation as a contributor
reference implementation. The actual tests live in `src/policy-types.test.ts`.

## Validation Scenarios

### SpendingConstructor

Valid combinations tested:
- Default values: `dailyLimitStroops="1000000"`, `windowSeconds=86400`
- Custom daily limit: `dailyLimitStroops="5000000"`, `windowSeconds=3600`
- Zero window: `dailyLimitStroops="100"`, `windowSeconds=0`
- Large window value: `windowSeconds=999999999`
- Empty string daily limit: `dailyLimitStroops=""`

### VerifiedRecipientConstructor

Valid combinations tested:
- Default registry: `registry="registry.example"`
- Custom registry: `registry="my-registry.stellar"`
- Subdomain registry: `registry="sub.registry.example"`
- Numeric registry: `registry="registry123.example"`

## Test Pattern

```typescript
import { SpendingConstructor, VerifiedRecipientConstructor } from "vellar-sdk";

function spending(dailyLimitStroops = "1000000", windowSeconds = 86400): SpendingConstructor {
  return { dailyLimitStroops, windowSeconds };
}

function verifiedRecipient(registry = "registry.example"): VerifiedRecipientConstructor {
  return { registry };
}
```

## Requirements Met

- ✅ Tests for all required field combinations
- ✅ Tests for edge cases (large values, empty strings, subdomains, numeric chars)
- ✅ Tests run as part of existing test suite (see `src/policy-types.test.ts`)