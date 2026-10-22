# isValidStellarAddress checksum tests

Tests that `isValidStellarAddress` rejects a C- or G-prefixed address with a
corrupted checksum (right length and prefix) by returning `false`, not throwing.
The suite runs against both the current `src/tx-rpc.ts` export and the
documented reference in `address-validation.ts`.

## Integration into core
Replace the one-line doc comment on `isValidStellarAddress` in `src/tx-rpc.ts`
with the one in `address-validation.ts` (checksum validation is part of the
contract), and move the test cases into `src/tx-rpc.test.ts`.
