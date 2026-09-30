# Whole-repo audit checklist — 2026-09-28/29

Umbrella tracker for the whole-repo audit (#529). Individual findings live in their own
issues; this file carries the state. Tick an item when its fix has merged to `dev`.

## Blocking correctness

- [ ] `src/x402-signer.ts` is missing a `/**` (breaks compile on `dev`)
- [ ] `src/session.test.ts` has an orphaned fragment
- [ ] `src/x402-signer.test.ts` has an orphaned fragment
- [ ] CI does not run on pushes to `dev`

## Deployment and docs

- [ ] Render hosts are suspended; Railway hosts are live
- [ ] Facilitator now advertises `stellar:pubnet`, docs say testnet-only
- [ ] Render cold-start note is no longer accurate
- [ ] `proofs.md` liveness check gates verified hashes
- [ ] `vellar-explorer` has no root route

## Follow-ups

- [ ] Tag-readiness check so a release cannot be cut from a broken branch (#528)
- [ ] Preflight command that checks a deployment end to end (#527)
- [ ] Unify the duplicated `DEFAULT_FACILITATOR_URL` constant (#525)
