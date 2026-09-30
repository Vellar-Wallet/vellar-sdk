# Issues #389, #386, #383, #390

Contributor PRs may only touch `contrib/` (CONTRIBUTING.md rule 3). All four
assigned issues genuinely require a change outside `contrib/` to be fully
wired in — each section below says exactly what, and keeps the change as
small as the issue allows. Everything in this folder is runnable today,
against the real, unmodified core, with **zero changes outside `contrib/`
required** to verify the findings.

```bash
npx vitest run contrib/v389-v386-v383-v390
node contrib/v389-v386-v383-v390/verify-wallet-wasm-hash.mjs
```

---

## #389 — Enforce `walletWasmHash` correctness in CI

**This one found a live bug.** `TESTNET.walletWasmHash` in `src/config.ts` is
currently

```
fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0
```

— which is passkey-kit's **PRE-FIX** smart-wallet hash, from
[`docs/deployments-testnet-2026-07-11.md`](https://github.com/stellar/passkey-kit/blob/v0.16.5/docs/deployments-testnet-2026-07-11.md)
(contract `binver: 1.0.0`). `package.json` has since moved to
`passkey-kit@^0.16.5`, whose own README points at the **later** manifest,
[`docs/deployments-2026-08-19.md`](https://github.com/stellar/passkey-kit/blob/v0.16.5/docs/deployments-2026-08-19.md)
(`binver: 1.0.1`), which states plainly:

> The release fixes two authorization failures. Every `Signature::Policy`
> entry now calls `policy__`. ... A missing required policy now fails closed
> with `MissingContext`.

The correct hash is `502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58`.
Confirmed on-chain: `getLedgerEntries` for the contract-code ledger key of
**both** hashes returns a real, installed WASM exporting the same
`__check_auth`/`add_signer`/etc. interface — the old hash isn't a typo that
fails loudly, it's a real, superseded contract that fails silently. Every
wallet created through this SDK's shipped `TESTNET` config since the
`passkey-kit` bump has been running the pre-fix contract.

### verify-wallet-wasm-hash.mjs

`node contrib/v389-v386-v383-v390/verify-wallet-wasm-hash.mjs` reads the
**installed** `passkey-kit` version, fetches that version's own README (which
names its current canonical manifest — the repo re-pins this pointer on every
contract change), fetches that manifest, and diffs the "Smart wallet" row's
hash against `src/config.ts`'s `TESTNET.walletWasmHash`. It already ran
against this repo and reproduced the mismatch above — see the script's own
header comment for the full mechanism and edge cases.

### Changes required (outside `contrib/`)

1. **`src/config.ts`** — fix the live bug:
   ```diff
   -  walletWasmHash: "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0",
   +  walletWasmHash: "502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58",
   ```
2. Move `verify-wallet-wasm-hash.mjs` from this folder to `scripts/`, and add
   to `package.json`:
   ```diff
      "check:docs": "node scripts/check-doc-snippets.mjs",
   +  "verify:wasm-hash": "node scripts/verify-wallet-wasm-hash.mjs",
      "test": "vitest run",
      ...
   -  "prepublishOnly": "npm run typecheck && npm test && npm run build",
   +  "prepublishOnly": "npm run typecheck && npm run verify:wasm-hash && npm test && npm run build",
   ```
3. **`.github/workflows/ci.yml`** — add a step after `npm run typecheck`:
   ```yaml
   - run: npm run verify:wasm-hash
   ```
   (and the same in `.github/workflows/publish.yml`, before `npm test`).
4. Document the finding in `docs/security-audit.md` as a new V-14 entry (see
   this folder's `security-audit-v14.md` for the drafted text, written in the
   doc's existing style).

---

## #383 — Hostile-RPC proof for the primary `x402-client` path

`packages/mcp-x402-payer/test/hostile-rpc.test.ts` already proves V-1 for the
MCP payer's own scheme client. `src/x402-client.ts` — which backs
`wallet.x402.fetch`, the path `vellar-dapp` depends on — had no equivalent
black-box test.

### x402-client-hostile-rpc.test.ts

Drives the **real, unmodified** `createX402Client` against a stub built by
spying on `rpc.Server.prototype` (`simulateTransaction`, `getLatestLedger`,
`getAccount`) rather than running a local plaintext HTTP server — see the
test file's header comment for why: `createX402Client` has no `allowHttp`
escape hatch the way `smart-account-scheme.ts` does, and adding one is a
`src/` change, so the contrib version proves the identical property
(`AuthEntryMismatchError`, signer never reached, on a real captured testnet
`simulateTransaction` response with only the recipient mutated) without
needing one. All 3 tests pass today, unmodified core, no plaintext RPC ever
contacted.

### Changes required (outside `contrib/`) — optional

None are required to close this issue — the proof above already exercises
the real `src/x402-client.ts`. If a maintainer prefers the local-server style
(matching `smart-account-scheme.ts` exactly, e.g. for consistency across the
two hostile-RPC tests), the smallest version of that is:

```diff
 export interface X402ClientDeps {
   ...
   now?: () => Date;
+  /**
+   * Permit a plaintext `http://` RPC. Default false, and deliberately NOT
+   * exposed as an environment variable — a plaintext RPC is exactly the
+   * position an attacker needs for V-1, so enabling it must be a code
+   * decision, not a deployment typo. Used by the hostile-RPC test.
+   */
+  allowHttp?: boolean;
 }
```
```diff
-  const server = new rpc.Server(deps.rpcUrl);
+  const allowHttp = deps.allowHttp ?? false;
+  const server = new rpc.Server(deps.rpcUrl, { allowHttp });
```
```diff
     const tx = await AssembledTransaction.build({
       contractId: requirements.asset,
       method: "transfer",
       args: [...],
       networkPassphrase: net.passphrase,
       rpcUrl: deps.rpcUrl,
+      allowHttp,
       publicKey: deps.simulationSourceAccount,
       parseResultXdr: (r: unknown) => r,
     });
```
If adopted, move `x402-client-hostile-rpc.test.ts` to `src/` and swap it to a
local `node:http` server the way the MCP-payer version does, passing
`allowHttp: true`.

---

## #386 — Verify multi-policy ScVal ordering against live chain behavior

`comparePolicyAddresses` (`src/x402-signer.ts`) sorts co-signer policy entries
by raw address bytes. The existing unit test
(`src/x402-signer-policies.test.ts`) only proves **internal self-consistency**
— forward and reversed input produce the same output — which would pass even
if raw-byte order were the *wrong* rule, since it's at least consistent with
itself. It doesn't establish Soroban's host actually **accepts** that order
with two or more policies present.

### verify-multi-policy-ordering.ts

Deploys a fresh testnet wallet governed by **two** real `sample-policy`
instances, attaches an Ed25519 agent signer whose `SignerLimits` require both,
signs a `transfer` with the SDK's own (unmodified) `createSessionKeySigner`,
and submits it. Full recipe and usage in the script's header comment.

**Result of the run that produced this section**, reproducible with the
script above:

- Wallet: `CACD4K6KT6TWVGFKFACWTM4GWBRYUB4EPVFDI7VUXRUULFFS4EITRHNE`
- Policy A: `CCRKBE7P4Z2I6LHSN2DI2DBL26QVHHHHJT6HMFA3RHM3QM4HE6I4OXRX`
- Policy B: `CBRLYBQZOJAKO3Q3KFG3KKYQKYPDR2ZWLLYVG6KIRXZBW63VVNT5EZUJ`
- Emitted signature map order: `Ed25519 -> Policy(CBRLY…) -> Policy(CCRKB…)`
  — raw-byte order, lexically consistent with the two contracts' `C…` StrKey
  prefixes.
- Submitted transaction:
  `7d9f1fa15e6a6220ce3731f7205ef32b2c8dd94621ecb5fcda15f9a5ece1eff4`,
  confirmed via Horizon: `successful: true` (ledger 4907382, 2026-09-28).
  Both policies' `policy__` ran (each approved the `transfer` under its
  cumulative allowance) — the map order did not trip Soroban's own
  map-key-ordering validation, which would otherwise reject `__check_auth`
  before any contract logic runs at all.

**Conclusion: no code change is required.** `comparePolicyAddresses`'
raw-address-bytes rule is correct, not merely internally consistent — it was
never wrong, it was only unverified against live chain behavior.

### Changes required (outside `contrib/`)

Record the verification as a comment at `comparePolicyAddresses` in
`src/x402-signer.ts`, so the next reader sees this was checked live rather
than re-deriving it or re-opening the question. Suggested text:

```diff
+/**
+ * Order two policy contract ids by their raw address bytes, as ScVal ordering does.
+ *
+ * VERIFIED LIVE ON TESTNET WITH TWO POLICIES PRESENT (issue #386). Prior unit
+ * tests (x402-signer-policies.test.ts) only proved internal self-consistency —
+ * a forward and a reversed policy list produce the same output order — which
+ * would pass even if raw-byte comparison were the wrong rule, since it is at
+ * least consistent with itself. This does not establish that Soroban's host
+ * ACCEPTS that order.
+ *
+ * A fresh wallet (`CACD4K6KT6TWVGFKFACWTM4GWBRYUB4EPVFDI7VUXRUULFFS4EITRHNE`)
+ * was deployed on testnet with an Ed25519 agent signer whose `SignerLimits`
+ * require TWO deployed `sample-policy` instances as co-signers
+ * (`CCRKBE7P4Z2I6LHSN2DI2DBL26QVHHHHJT6HMFA3RHM3QM4HE6I4OXRX` and
+ * `CBRLYBQZOJAKO3Q3KFG3KKYQKYPDR2ZWLLYVG6KIRXZBW63VVNT5EZUJ`) on a native-XLM
+ * SEP-41 `transfer`. This function (via `createSessionKeySigner`, unmodified)
+ * sorted them as `Ed25519 -> Policy(CBRLY…) -> Policy(CCRKB…)` — raw-byte order,
+ * lexically consistent with their `C…` StrKey prefixes. The signed payment was
+ * submitted and settled: testnet tx
+ * `7d9f1fa15e6a6220ce3731f7205ef32b2c8dd94621ecb5fcda15f9a5ece1eff4`,
+ * `successful: true` (ledger 4907382, 2026-09-28), confirmed via Horizon. Both
+ * policies' `policy__` ran (each approved a `transfer` under its cumulative
+ * allowance) — the map order did not trip Soroban's own map-key-ordering
+ * validation, which would otherwise reject `__check_auth` before any contract
+ * logic runs at all. No change to this function was required: raw address
+ * bytes is the correct rule, not merely an internally-consistent one.
+ */
 function comparePolicyAddresses(a: string, b: string): number {
```

Also worth a one-line update to `docs/security-audit.md`'s "What I could not
break" ScVal-map-ordering bullet, pointing at this verification (see
`security-audit-v14.md` in this folder, which drafts both that update and the
V-14 entry together).

---

## #390 — Assess reachability of CVEs behind the softened npm audit gate

The CI/publish `npm audit` gate softened from `--audit-level=high` to
`--audit-level=critical` on 2026-09-07. `npm audit` at `--audit-level=high`
currently names, among others, the toml chain the issue asks about:

- **`smol-toml` ≤1.7.0, `GHSA-7w5x-hrqm-74c2`** (DoS via malformed TOML) — via
  this package's own direct `@stellar/stellar-sdk@16.x` devDependency.
- **`toml` ≤4.1.2, `GHSA-82x6-q7mm-w9cf` / `GHSA-v5mp-jgw5-2x6j`** (uncontrolled
  recursion; prototype pollution) — via `passkey-kit@0.12–0.18` →
  `@openzeppelin/relayer-plugin-channels` → a pinned `@stellar/stellar-sdk@≤15.1.0`.

### Reachability, traced to the actual call sites

Both `smol-toml` and `toml` are consumed inside `@stellar/stellar-sdk` by
exactly **one** module: `stellartoml/index.js` (`StellarTomlResolver`, used
for federation / anchor `stellar.toml` domain discovery). Confirmed by
exhaustive grep: this package's `src/` never imports it, directly or
transitively through any module it does import.

The `toml` chain specifically requires reaching `passkey-kit`'s bundled, older
`@stellar/stellar-sdk@14.6.1`, which is only pulled in through
`passkey-kit/server` (`PasskeyServer`, the relayer/channel-account submission
path — its `dist/server.js` statically imports
`@openzeppelin/relayer-plugin-channels`). `passkey-kit`'s default export
(`dist/kit.js` → `dist/index.js`, the `PasskeyKit` class this SDK actually
imports in `src/passkeykit-connector.ts`) **never imports `server.js`**:
confirmed by reading `passkey-kit`'s `dist/index.js` export list (no
`PasskeyServer` — it's a separate `passkey-kit/server` subpath export) and
`dist/kit.js`'s full import list (no `relayer.js`/`server.js`). So neither
vulnerable module executes as this SDK loads and runs `passkey-kit` — a
consumer would have to separately `import "passkey-kit/server"` themselves to
reach it at all, which is a decision outside this package's own signing path.

### `smol-toml` (and `hono`, `qs`, `fast-uri`, `ip-address`) — fixable lockfile-only, today

`npm audit fix` (no `--force`) resolves `smol-toml` along with four unrelated
moderates (`hono`, `qs`, `fast-uri`, `ip-address`) picked up in the same
audit. No `package.json` range changes — verified with `npm audit fix
--dry-run`. This can be applied and committed (`package-lock.json` only) with
zero other changes.

### `toml` — the fix is a real major bump, correctly deferred

`npm audit fix --force` reports the fix as `passkey-kit@0.19.1`, a major
version outside the declared peer range `>=0.13.0 <0.17.0`, matching the
policy in `ci.yml`'s existing comment ("anything needing a `package.json`
range change is reported and decided, not forced through by CI").

### Conclusion

**The softened gate is a documented and justified decision, not an open
question.** Neither toml-chain advisory is reachable from this SDK's own
signing path. The one piece that *was* genuinely fixable (`smol-toml`) had
never been applied.

### Changes required (outside `contrib/`)

1. Run `npm audit fix` and commit the resulting `package-lock.json` (no
   `package.json` change) — closes `smol-toml`, `hono`, `qs`, `fast-uri`,
   `ip-address`.
2. **`.github/workflows/ci.yml`** and **`.github/workflows/publish.yml`** —
   the softening comment cites `#378`, an unrelated V1/V2 auth-entry issue.
   Correct it:
   ```diff
      # Tracked: https://github.com/Vellar-Wallet/vellar-sdk/issues/378
   +  # Tracked: https://github.com/Vellar-Wallet/vellar-sdk/issues/390
   ```
   (and expand the comment to note the reachability conclusion — see the
   drafted full comment block in `security-audit-v14.md`).
3. **`docs/security-audit.md`** V-8 — add the addendum drafted in
   `security-audit-v14.md` in this folder (same file as the #389 doc change,
   since both are additions to the same audit document).
