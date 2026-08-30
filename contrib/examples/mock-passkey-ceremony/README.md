# Mock passkey ceremony for CI

A deterministic mock passkey registration + authentication ceremony —
useful for wiring into a CI test suite that needs a stable "user has a
passkey" scenario without a real browser or WebAuthn/authenticator support.

## Flow

1. `generateMockCredential(seed)` derives a `{ credentialId, publicKey }`
   pair from `seed` using a small seeded PRNG (mulberry32). **The same seed
   always produces the same credential** — no hidden randomness, no global
   state, reproducible across processes and CI runs.
2. `createMockAuthenticator()` wraps that generator with an in-memory
   "authenticator": `register(seed)` derives and remembers a credential;
   `authenticate(credentialId)` looks it up, throwing for an id that was
   never registered — the same refusal a real authenticator gives for an
   unknown credential.

## Usage

```ts
import { createMockAuthenticator } from "./mock-passkey-ceremony";

const authenticator = createMockAuthenticator();
const { credential } = authenticator.register("alice-device");
const { credential: authed } = authenticator.authenticate(credential.credentialId);
// authed.credentialId === credential.credentialId
```

## Run it

```sh
npx tsx mock-passkey-ceremony.ts
```

Expected output (the two determinism-check lines are always identical to
each other, though the exact hex values are fixed by the PRNG):

```
Determinism check: generateMockCredential('alice-device') called twice...
  call 1: a638baa8f7332b207ac6e86a8bcb454c
  call 2: a638baa8f7332b207ac6e86a8bcb454c
  same credentialId both times: true

Full register-then-authenticate sequence:
  Step 1: register with seed 'alice-device'
    registered credentialId = a638baa8f7332b207ac6e86a8bcb454c
  Step 2: authenticate with that credentialId
    authenticated at 2026-...-...T...Z, publicKey = ...
```

## Tests

```sh
npx vitest run contrib/examples/mock-passkey-ceremony
```
