# Policy migration dry run

Previews what an old-style (pre-v1) policy configuration would look like
migrated to the current `PolicyDefinition` shape (`src/types.ts`), **without
applying anything**. Reports any old fields that have no equivalent in the
new shape, so a caller can decide what to do with them before migrating for
real.

## Field mapping

| Old field | New field | Notes |
| --- | --- | --- |
| `policyOwner` (single string) | `owners` (`string[]`) | Wrapped in a single-element array — the new shape supports multiple owners, the old one didn't. |
| `dailyLimit` | `spendingLimits.dailyXlm` | |
| `perTxLimit` | `spendingLimits.perTxXlm` | |
| `allowedContracts` | `allowlistedContracts` | |
| `adminDelaySeconds` | `timelocks.adminActionDelaySeconds` | |
| `legacyFlag` | *(none)* | Every policy is now versioned by its deployed contract wasm hash instead. Dropped. |
| `notes` | *(none)* | Free-text notes had no structured home in the old shape either. Dropped. |

## Run it

```sh
npx tsx policy-migration-dry-run.ts
```

Expected output (against the sample old config with all fields, including
the two unmapped ones):

```
Migration preview: {
  version: '1',
  type: 'spending-limit',
  owners: [ 'GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' ],
  spendingLimits: { dailyXlm: '100', perTxXlm: '20' },
  allowlistedContracts: [ 'CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' ],
  timelocks: { adminActionDelaySeconds: 3600 }
}

Unmapped fields (dropped, no equivalent in the new shape): [ 'legacyFlag', 'notes' ]
```

## Tests

```sh
npx vitest run contrib/examples/policy-migration-dry-run
```
