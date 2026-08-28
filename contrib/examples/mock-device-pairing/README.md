# Mock device pairing flow for tests

A mock version of the extension device pairing flow — **request**,
**approve**, then **issue-session** — useful for wiring into a test suite
that needs a "device is paired" scenario without a real browser extension.
State is a plain in-memory `Map`; there's no network or WebAuthn involved.

## Flow

`createMockPairingFlow()` returns three functions sharing in-memory state:

1. **`request(deviceLabel)`** — a device asks to be paired. Returns a
   `PairingRequest` with `status: "pending"`.
2. **`approve(requestId)`** — approves a pending request (in a real flow,
   confirmed from an already-paired device). Throws for an unknown
   `requestId`.
3. **`issueSession(requestId)`** — issues a session for an **approved**
   request only. Calling it on a request that is still `"pending"` (or
   doesn't exist) **throws a clear error instead of returning a session** —
   a real backend must never hand out a session before the paired device
   confirms.

## Usage

```ts
import { createMockPairingFlow } from "./mock-device-pairing";

const flow = createMockPairingFlow();

const req = flow.request("Chrome extension on laptop"); // status: "pending"
flow.issueSession(req.requestId); // throws: not approved yet

flow.approve(req.requestId); // status: "approved"
const session = flow.issueSession(req.requestId); // { sessionId, requestId, deviceLabel, issuedAt }
```

## Run it

```sh
npx tsx mock-device-pairing.ts
```

Expected output:

```
Step 1: request pairing for 'Chrome extension on laptop'
  requestId=req_1 status=pending
Step 2: issue a session before approval (should fail)
  error: Pairing request "req_1" is not approved yet (status: "pending")
Step 3: approve the request
  requestId=req_1 status=approved
Step 4: issue the session now that it's approved
  sessionId=sess_1 deviceLabel=Chrome extension on laptop
```

## Tests

```sh
npx vitest run contrib/examples/mock-device-pairing
```
