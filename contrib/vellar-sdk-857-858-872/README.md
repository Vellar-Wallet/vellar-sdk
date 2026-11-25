# Mainnet and local-facilitator preflight references

This contrib-only package supplies small, side-effect-free references for the
assigned configuration and local-facilitator issues.

- `mainnet-config-preflight.ts` reports missing and malformed `rpcUrl` and
  `walletWasmHash` values separately, before a consumer constructs a mainnet
  SDK configuration (#857, #858).
- `catalog-directory-preflight.ts` fails early when a local facilitator data
  directory has not been created. The documented operator command requires
  `mkdir -p data` before starting with `CATALOG_DB_URL` (#872).

## Integration path

These examples intentionally do not modify SDK source. A maintainer can move
the regression cases into the core test suite or invoke the directory guard in
the local facilitator integration fixture after explicitly widening scope.
