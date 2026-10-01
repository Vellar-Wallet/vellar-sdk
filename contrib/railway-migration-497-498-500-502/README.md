# Render to Railway migration (#497, #498, #500, #502)

The hosted services moved from Render (suspended, every request returns 503) to
Railway. The fixes for these four issues touch files outside `contrib/` (docs,
package sources, a workflow), so they are delivered here as ready-to-apply
patches for a maintainer, per [CONTRIBUTING.md](../../CONTRIBUTING.md).

| Patch | Issue | Scope |
| --- | --- | --- |
| `0001-docs-remove-outdated-Render-cold-start-notes.patch` | #502 | Removes the 45s/120s Render idle-sleep guidance from the docs |
| `0002-docs-replace-Render-URLs-with-live-Railway-hosts.patch` | #500 | Replaces every `onrender.com` host in docs, READMEs, pitch deck and the keepalive workflow |
| `0003-fix-point-CLI-and-MCP-payer-at-live-Railway-facilita.patch` | #498 | Updates `DEFAULT_FACILITATOR_URL` in the CLI and MCP payer, plus the test and the stale cold-start error hint |
| `0004-ci-run-CI-on-pushes-to-dev.patch` | #497 | Adds `dev` to the `push` branches in `.github/workflows/ci.yml` |

## Applying

From a checkout of `dev`, apply in order (the patches build on each other):

```sh
git am contrib/railway-migration-497-498-500-502/*.patch
```

They apply cleanly on `dev` at `c8f6fbe`. Together they change 37 files.

## Live hosts

| Service | URL | Check |
| --- | --- | --- |
| facilitator | `https://vellar-facilitator-production.up.railway.app` | `/health` 200 |
| seller demo | `https://vellar-seller-demo-production.up.railway.app` | `/quote` 402 with a valid challenge |
| backend | `https://vellar-backend-production.up.railway.app` | `/health` 200 |
| explorer | `https://vellar-explorer-production.up.railway.app` | only `/health` responds; `/` is 404 |

## Notes for the maintainer

- `website/content/docs/reference/explorer.md` now points at the Railway
  explorer host, but per #500 only `/health` responds there. The documented
  `/payments` routes were not verified against it.
- `packages/mcp-x402-payer/src/pay-and-call.ts` no longer appends the
  "cold-starting, roughly 45 seconds" hint to its unreachable-Bazaar error, and
  the matching `T-4` assertion in `pay-and-call.test.ts` was dropped.
- The patches were not run through `npm test` before packaging.
