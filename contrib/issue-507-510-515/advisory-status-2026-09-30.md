# Upstream advisory status for the toml chain — re-checked 2026-09-30

The record #515 asks for, with the evidence behind it. Tracked:
[#378](https://github.com/Vellar-Wallet/vellar-sdk/issues/378). Machine-checked
against the live tree by `audit-advisory-policy.test.ts`; run
`node contrib/issue-507-510-515/audit-advisory-policy.mjs` to reproduce the
counts.

## Current status

`npm audit --json` against `package-lock.json` at commit `3d583b5`:

| Severity | Vulnerable packages | Distinct advisories |
| --- | --- | --- |
| critical | 0 | 0 |
| high | 5 | 3 |
| moderate | 7 | 11 |
| low | 1 | 1 |
| **total** | **13** | **15** |

Two numbers, not one. The issue was filed against "5 high, 4 moderate, 1 low";
the moderates have since gone 4 → 7 (`hono`, `ip-address`, `qs`) while the highs
are unchanged. The gate floor is `high`, so it still passes — but a count written
in a comment is the first thing to go stale, which is why
`evaluateAuditReport` computes both instead.

Advisories are counted *distinctly*. `npm audit` reports one advisory once per
package that carries it, so a naive count double-counts anything a wrapper and
its dependency both report: Vitest's `GHSA-82fw-gwwq-j7x9` appears on both
`vitest` and `@vitest/mocker` and is one advisory, not two.

The header of `scripts/audit-gate.mjs` reads "All five highs resolve to one chain"
directly above a three-URL `ALLOWED` list. Both are correct about **different
things** — five vulnerable *packages*, three high *advisories* — and that is
exactly why a reader has to stop and work it out.

## The chain, and the correction to it

```
passkey-kit@0.16.5                          (dev, optional peer dependency)
  └─ @openzeppelin/relayer-plugin-channels@0.20.0   (dev)
       └─ @stellar/stellar-sdk@14.6.1               (dev, nested)
            └─ toml@3.0.0                            → GHSA-82x6-q7mm-w9cf
                                                    → GHSA-v5mp-jgw5-2x6j

@stellar/stellar-sdk@16.2.0                 (PRODUCTION, direct peer dependency)
  └─ smol-toml@1.7.0                              → GHSA-7w5x-hrqm-74c2
```

Four of the five highs are the `passkey-kit` chain the issue describes. **The
fifth is not.** `smol-toml@1.7.0` sits at `node_modules/smol-toml` — the root
path, `"dev": false` in the lockfile — reached from the production
`@stellar/stellar-sdk@16.2.0` that this package declares as a direct
`peerDependency`. The `≤15.x` copy does not depend on `smol-toml` at all; it
depends on `toml`. The two are different packages on different branches.

The recorded reason in `scripts/audit-gate.mjs:35` calls GHSA-7w5x "Transitive of
@stellar/stellar-sdk ≤15.x. Not reachable: the SDK parses no TOML at runtime."
That attribution is wrong, and it is the more serious of the two highs, because
the dev-only reachability argument does not apply to it.

## Upstream HAS resolved it — neither half needs a major override

The recorded posture is that the chain is "unresolved upstream" and that closing
it would take "a major-version override … unsafe inside the passkey signing
path". For the `toml` half the sub-claim is right: `@stellar/stellar-sdk@14.6.1`
pins `toml@^3.0.0` and every fix is 4.x or 5.x, so closing it *there* would be a
major override. But there is a route that is not one.

**1. `smol-toml` — closable with a lockfile pin today.**

| | |
| --- | --- |
| Vulnerable range | `<=1.7.0` |
| Locked | `1.7.0` |
| Available upstream | `1.7.1`, `1.7.2`, `1.8.0`, `1.9.0` |
| Declared by root stellar-sdk | `^1.6.1` — **already admits 1.7.1+** |

```json
"overrides": {
  "fast-uri": "3.1.7",
  "smol-toml": "1.9.0"
}
```

Identical in shape to the `fast-uri` override that already closes four highs. No
major version, nothing in the passkey signing path, no reachability argument
needed. This advisory does not need to be carried.

**2. `toml` — the whole chain disappears on a MINOR bump.**

`passkey-kit@0.17.0` **dropped `@openzeppelin/relayer-plugin-channels`
entirely.** Verified against the registry across every release since the locked
one:

| passkey-kit | declares `relayer-plugin-channels`? | `@stellar/stellar-sdk` |
| --- | --- | --- |
| 0.16.5 (locked) | yes | `>=16.0.0` |
| 0.17.0 | **no** | `>=16.0.0` |
| 0.17.3 | **no** | `>=16.0.0` |
| 0.18.0 | **no** | `^16.3.0` |
| 0.18.3 | **no** | `^16.3.0` |
| 0.19.0 | **no** | `^16.3.0` |
| 0.19.1 (latest) | **no** | `^16.3.0` |

The `toml@3.0.0` copy exists only under that package, so the bump removes it
outright rather than overriding it. The blocker is the declared peer range:

```json
"peerDependencies": { "passkey-kit": ">=0.13.0 <0.17.0" }
```

Widening a peer range is a consumer-visible compatibility decision, and the
audit-gate comment is right that it must be "reported and decided, not forced
through by CI". But it is a MINOR bump of an optional dev-adjacent peer, not the
major-version override the current rationale rules out.

## What this changes about the gate

Nothing about the mechanism. The named allowlist, the `high` floor, and the
`2026-12-15` expiry are all sound and should stay. Two things follow:

1. **The allowlist is now carrying two advisories with a known fix.** Neither
   needs the dev-chain rationale any more. Once the two bumps land, all three
   entries are removable and the gate returns to a bare `npm audit --audit-level=high`.
2. **The smol-toml entry's recorded reason should be corrected now**, regardless
   of whether the bump happens today. A wrong justification is worse than an
   honest narrow one, because the next person to re-check will trust it.

## The two moderates already pinned, for contrast

`fast-uri` is the precedent that makes the `smol-toml` recommendation cheap to
adopt: `overrides: { "fast-uri": "3.1.7" }` already closed four highs on a
transitive path with a single line and no package-range change. `GHSA-hrr3-gc8f-f4qj`
now reports against `node_modules/ajv/node_modules/fast-uri` (moderate) because
that is a *different*, nested copy the root override does not reach — the same
shape of gap as smol-toml, one severity down.
