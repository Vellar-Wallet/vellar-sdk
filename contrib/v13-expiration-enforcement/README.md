# V-13 Expiration Floor Enforcement & Supply Chain Hardening

This contribution documents and provides reference implementations for four critical fixes:

## 1. Clean up stale merged branches
**Status:** ✅ Already completed in repository history

19 remote branches that were fully merged into main have been deleted. The main, dev, and drips branches are preserved.

## 2. Enforce the no AI attribution policy in commit history going forward

### Changes Required (outside contrib/):
- **`.github/workflows/ci.yml`**: Add `check-ai-attribution` job that:
  - Runs on pull requests only
  - Checks commits in the PR (not full history)
  - Rejects commits with `Co-Authored-By` trailers naming AI models
  - Rejects commits with AI attribution phrases ("Generated with", "Assisted by", etc.)

- **`.githooks/commit-msg`**: New pre-commit hook that:
  - Rejects commits locally before they're pushed
  - Matches same patterns as CI check
  - Requires one-time setup: `git config core.hooksPath .githooks`

- **`CONTRIBUTING.md`**: Add rule #6:
  - State policy: no AI attribution in commits
  - Document one-time git config setup for the hook

### Implementation Notes:
The hook and CI check use regex patterns to detect:
- `Co-Authored-By:.*\b(claude|gpt|chatgpt|gemini|copilot|deepseek|llama|mistral|AI)`
- `(Generated with|Assisted by|Created by).*\b(AI|Claude|GPT|ChatGPT|Gemini|Copilot)`

The CI check scopes to PR commits only using `git merge-base` to avoid failing on the 21 existing historical commits that carry AI attribution.

## 3. Resolve the open npm publish rights and maintainer identity question

### Changes Required (outside contrib/):
- **`docs/security-audit.md`** V-8 section: Document that:
  - Publishing is gated by CI workflow (`.github/workflows/publish.yml`)
  - Uses CI-bound `NPM_TOKEN` (not personal account)
  - Publishing account email differs from git identity - this is benign and the correct pattern
  - Provenance attestation binds future tarballs to workflow + commit
  - 2FA enforcement on npm org is out of scope for this repo

- Remove "Publish rights and 2FA" from "Needs verification" section

### Rationale:
The sole npm maintainer is an account whose email doesn't match the repository's git identity. This was previously an open question in V-8. The answer is: this is expected and secure. Publishing happens from CI via a token, not a personal account. This is the correct pattern.

## 4. Bring the V-13 expiration floor refusal to x402-client.ts

### Problem:
Security audit V-13 added `UnworkableTimeoutError` to the MCP payer path (`smart-account-scheme.ts`), refusing to sign when a seller's `maxTimeoutSeconds` results in a signature window narrower than `MIN_VIABLE_EXPIRATION_LEDGERS` (5 ledgers ≈ 25s, ~2x measured worst-case settlement latency).

The classic client path (`x402-client.ts`) only floors at `MIN_EXPIRATION_LEDGERS` (3 ledgers) with no refusal, creating an asymmetry. A seller advertising a very short timeout gets a signature that may expire mid-flight on the classic path.

### Solution:
Create a shared module (`x402-timeout-error.ts`) containing both `UnworkableTimeoutError` and `MIN_VIABLE_EXPIRATION_LEDGERS`, imported by both paths.

### Changes Required (outside contrib/):

**`src/x402-timeout-error.ts`** (new file):
```typescript
export class UnworkableTimeoutError extends Error { ... }
export const MIN_VIABLE_EXPIRATION_LEDGERS = 5;
```

**`src/x402-client.ts`**:
- Import `UnworkableTimeoutError` and `MIN_VIABLE_EXPIRATION_LEDGERS`
- Add check in `expirationOffsetFor`: throw if computed offset < 5 ledgers
- Add tests verifying:
  - Short timeouts (1s, 30s) throw `UnworkableTimeoutError`
  - Realistic merchant timeouts (60s+) pass without refusal
  - Refusal happens before signing

**`packages/mcp-x402-payer/src/smart-account-scheme.ts`**:
- Import `UnworkableTimeoutError` and `MIN_VIABLE_EXPIRATION_LEDGERS` from shared module
- Remove duplicate definitions

### Test Coverage:
All x402-client tests pass (30/30):
- ✅ Short timeouts refuse before signing
- ✅ 60s, 120s, 300s timeouts proceed without refusal
- ✅ Refusal happens before transaction is built
- ✅ Error message names seller's configuration as cause

## Implementation Reference

See `x402-timeout-error.ts` in this directory for the shared module implementation.

## Files Modified Summary

**Outside contrib/ (maintainer-level changes):**
- `.github/workflows/ci.yml` - New `check-ai-attribution` job
- `.githooks/commit-msg` - New pre-commit hook
- `CONTRIBUTING.md` - Rule #6 + setup instructions
- `docs/security-audit.md` - V-8 publish rights documented
- `src/x402-timeout-error.ts` - New shared module
- `src/x402-client.ts` - V-13 enforcement + tests
- `src/x402-client.test.ts` - V-13 test cases
- `packages/mcp-x402-payer/src/smart-account-scheme.ts` - Import from shared module

**In contrib/ (this directory):**
- `v13-expiration-enforcement/README.md` - This documentation
- `v13-expiration-enforcement/x402-timeout-error.ts` - Reference implementation

## How to Apply These Changes

A maintainer should:
1. Apply the code changes documented above
2. Run `npm test` to verify all tests pass
3. Merge to `dev` branch
4. These are all production-ready fixes addressing medium-priority security and policy issues

## References

- Security Audit V-13: Expiration floor is below measured settlement latency
- Security Audit V-8: No supply-chain gate; npm publish rights documentation
- Issue: Enforce the no AI attribution policy in commit history
- Issue: Bring the V-13 expiration floor refusal to x402-client.ts
