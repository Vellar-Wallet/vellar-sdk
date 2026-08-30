# mock-policy-attach

Mock `PolicyAttachRuntime` suitable for unit tests.

- `attachPolicy(...)` always returns a fixed sample transaction hash.
- `resume(...)` is a no-op and resolves immediately.

This deliberately does not perform any passkey prompt or network I/O.

## Usage

```ts
import { createMockPolicyAttachRuntime } from "./index";

const attach = createMockPolicyAttachRuntime();

const result = await attach.attachPolicy("CPOLICY");
console.log(result.hash); // fixed sample hash

await attach.resume("key-id"); // no-op
```

Ref: `PolicyAttachRuntime`.