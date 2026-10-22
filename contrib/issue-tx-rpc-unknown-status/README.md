# Unrecognized RPC transaction status

`createRpcTxStatusReader` used to fold every status other than SUCCESS/FAILED
into `pending`, so a status added by a newer Soroban RPC was indistinguishable
from "not yet included".

**Decision:** warn and return `pending` (do not throw). Only SUCCESS and FAILED
are final, so an unknown value can never be misread as success, and
`waitForTransaction` keeps polling and ends in `TransactionTimeoutError` if the
status never resolves. `NOT_FOUND` is now handled explicitly and the decision is
documented in the switch comment.

## Integration into core
Copy the `switch` from `status-reader.ts` into `createRpcTxStatusReader` in
`src/tx-rpc.ts`, add the optional `server` option, and move the tests into
`src/tx-rpc.test.ts`.
