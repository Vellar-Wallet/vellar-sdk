# Drafted `docs/security-audit.md` additions for #389, #386, #390

Ready to paste into `docs/security-audit.md`. Written in the document's
existing style (severity, `[our code]`/`[supply chain]` tag, attack path,
fix, verify, `#### ✅ FIXED` block) so it reads as part of the same document,
not a bolt-on.

## 1. New row in the findings table (top of the doc)

```diff
 | [V-13](#v-13) | Expiration floor is below measured settlement latency | **Low** | our code | ✅ **FIXED** |
+| [V-14](#v-14) | TESTNET.walletWasmHash pinned a superseded, pre-fix contract | **High** | our code | ✅ **FIXED** |
```

## 2. New V-14 section (insert after V-13's closing `---`, before "## Lessons, recorded because they generalise")

```markdown
### V-14 — TESTNET.walletWasmHash pinned a superseded, pre-fix contract {#v-14}

**Severity: High.** Every consumer creating a testnet wallet through this SDK's shipped
`TESTNET` config deployed the smart-wallet contract from *before* an upstream authorization
fix, silently.

**[our code]** — `src/config.ts`, `TESTNET.walletWasmHash`.

Found while building the CI check for [#389](https://github.com/Vellar-Wallet/vellar-sdk/issues/389)
(which exists precisely because this value has no automated tie to the passkey-kit version it
must match). `TESTNET.walletWasmHash` was `fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0`
— the smart-wallet hash from passkey-kit's `docs/deployments-testnet-2026-07-11.md` (contract
`binver: 1.0.0`). `package.json` had since moved to `passkey-kit@^0.16.5`, whose own README
points at a *later* manifest, `docs/deployments-2026-08-19.md` (`binver: 1.0.1`), which states
plainly: "The release fixes two authorization failures. Every `Signature::Policy` entry now
calls `policy__`. … A missing required policy now fails closed with `MissingContext`." The
configured hash was never moved to the fixed contract when passkey-kit was bumped past it.

**Attack path.** None required — this is not attacker-triggered. Every wallet a consumer
deployed via `TESTNET` between the 2026-08-19 upstream fix and this correction ran the
pre-fix `__check_auth`, carrying whatever exposure that release closed for wallets governed
by a required policy.

**Impact.** Wallets deployed with a policy-governed signer during that window may not enforce
`SignerLimits` the way the current contract does. Existing deployed instances are unaffected by
this SDK-side fix — passkey-kit's own manifest is explicit that upgrading a wallet's code
requires an authorized `upgrade` call per instance; changing this constant only fixes *newly
created* wallets going forward.

**Fix.** `walletWasmHash` updated to `502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58`
(passkey-kit@0.16.5's canonical hash per `deployments-2026-08-19.md`, confirmed live on testnet
via `getLedgerEntries` against the contract-code ledger key for both hashes — the old one
resolves to a real, installed, pre-fix WASM exporting the same interface, which is why this
drifted silently rather than failing loud). `scripts/verify-wallet-wasm-hash.mjs` (issue #389)
now ties this value to the installed passkey-kit version in CI and at `prepublishOnly`, so a
future passkey-kit bump cannot repeat this silently — it fails the build with the manifest URL
and the correct hash instead.

**Verify the fix.** `npm run verify:wasm-hash` passes with the current pin; corrupting
`walletWasmHash` to any other 64-hex value makes it fail with a diff and a link to the manifest
that names the correct one (exercised by hand while building the check: `npm run
verify:wasm-hash` failed for the stale value above and passed once corrected).

---
```

## 3. Addendum to the existing V-8 section (append at the end of V-8, before its closing `---`)

```markdown
#### Addendum — 2026-09-30: reachability of the toml-chain advisories behind the softened gate

The CI and publish gates were softened from `--audit-level=high` to
`--audit-level=critical` on 2026-09-07 (workflow comments in `ci.yml` and
`publish.yml`, previously mis-citing #378 — an unrelated V1/V2 auth-entry
issue — now corrected to reference
[#390](https://github.com/Vellar-Wallet/vellar-sdk/issues/390), the actual
tracker). `npm audit` at `--audit-level=high` names two chains, both
resolving to a TOML parser:

- **`smol-toml` ≤1.7.0, `GHSA-7w5x-hrqm-74c2`** (DoS via malformed TOML) — via
  this package's own direct `@stellar/stellar-sdk@16.x` devDependency.
- **`toml` ≤4.1.2, `GHSA-82x6-q7mm-w9cf` / `GHSA-v5mp-jgw5-2x6j`** (uncontrolled
  recursion; prototype pollution) — via `passkey-kit@0.12–0.18` →
  `@openzeppelin/relayer-plugin-channels` → a pinned `@stellar/stellar-sdk@≤15.1.0`.

**`smol-toml` — fixed, lockfile-only.** `npm audit fix` (no `--force`)
resolved it, along with unrelated moderates (`hono`, `qs`, `fast-uri`,
`ip-address`) picked up in the same run. No `package.json` range changed.

**`toml` — traced to its call site and confirmed NOT reachable at runtime.**
Both `smol-toml` and `toml` are consumed inside `@stellar/stellar-sdk` by
exactly one module: `stellartoml/index.js` (`StellarTomlResolver`, used for
federation / anchor `stellar.toml` domain discovery). This package's `src/`
never imports it — confirmed by exhaustive grep, not inference. The `toml`
chain specifically requires reaching `passkey-kit`'s bundled, older
`@stellar/stellar-sdk@14.6.1`, which is only pulled in through
`passkey-kit/server` (`PasskeyServer`, the relayer/channel-account submission
path, which statically imports `@openzeppelin/relayer-plugin-channels`).
`passkey-kit`'s default export (`kit.js` → `index.js`, the `PasskeyKit` class
this SDK actually imports in `src/passkeykit-connector.ts`) never imports
`server.js` — confirmed by reading `passkey-kit`'s `dist/index.js` export
list and `dist/kit.js`'s import graph. So neither module executes inside
`node_modules` as this SDK loads and runs it; a consumer would have to
separately `import "passkey-kit/server"` themselves to reach it at all, which
is a decision outside this package's own signing path.

**Conclusion: the softened gate is a documented and justified decision, not
an open question.** The fix (`passkey-kit@0.19.1`) is a major bump outside
the declared peer range `>=0.13.0 <0.17.0` and was correctly deferred by the
existing "lockfile-only" policy — not because the advisory was ignored, but
because tracing it showed the vulnerable code path is dead weight in this
SDK's own dependency graph. Restore `--audit-level=high` once `passkey-kit`
drops the vulnerable `relayer-plugin-channels` version, or if this package
ever imports `passkey-kit/server` (at which point this reachability analysis
no longer holds and must be redone).
```

## 4. One-line addition to "What I could not break" (ScVal map ordering bullet)

```diff
 - **ScVal map ordering.** `"Ed25519"` sorts before `"Policy"`, and multi-policy ordering is
   by raw address bytes (`src/x402-signer.ts:150-160`); config order does not change output,
   asserted in `src/x402-signer-policies.test.ts:104-113`. I found no map that is *wrong yet
   still validates* — the failure mode I was specifically asked to hunt.
+  **Update 2026-09-30 (issue #386):** that self-consistency check couldn't rule out the rule
+  being wrong-but-consistent — verified live instead, with a real wallet governed by two
+  deployed policies, a signed `transfer`, and a settled testnet tx
+  (`7d9f1fa15e6a6220ce3731f7205ef32b2c8dd94621ecb5fcda15f9a5ece1eff4`). See the comment at
+  `comparePolicyAddresses` in `src/x402-signer.ts`.
```

## 5. Corrected workflow comments (`.github/workflows/ci.yml` and `publish.yml`)

```diff
       # Gate softened from --audit-level=high to --audit-level=critical on
       # 2026-09-07. Remaining highs are in the toml chain via passkey-kit →
       # @openzeppelin/relayer-plugin-channels → @stellar/stellar-sdk ≤15.x — a
-      # major-version override is unsafe inside the passkey signing path.
-      # Tracked: https://github.com/Vellar-Wallet/vellar-sdk/issues/378
-      # Restore to --audit-level=high when upstream resolves.
+      # major-version override (passkey-kit@0.19.1) is outside the declared
+      # peer range and was assessed, not just deferred: the vulnerable toml
+      # parser is only reachable via `passkey-kit/server`'s relayer module,
+      # which this SDK never imports (see docs/security-audit.md V-8).
+      # Tracked: https://github.com/Vellar-Wallet/vellar-sdk/issues/390
+      # Restore to --audit-level=high when passkey-kit resolves upstream.
       - run: npm audit --audit-level=critical
```
