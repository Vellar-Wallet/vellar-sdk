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

Any allowlist this repo writes has to be sized by advisories, not by packages, and
the difference is not cosmetic. Five vulnerable *packages* carrying three high
*advisories* is not a contradiction — `passkey-kit`,
`relayer-plugin-channels` and the nested `stellar-sdk` are high because they
depend on something high, and `toml` alone carries two of the three advisories. A
gate that lists one number where the other was meant reads as a discrepancy and
gets "fixed" by whichever number is easier to count.

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

So the reachability argument that is natural to write for this chain — "dev-only,
reached through an optional peer dependency, parses no TOML at runtime" — does
not apply to the advisory that is actually on the production path. An allowlist
entry that borrows it is carrying a justification that is false, and it is false
about the higher-consequence of the two.

## Upstream HAS resolved it — neither half needs a major override

`ci.yml` currently defers the decision: "Restore to `--audit-level=high` when
upstream resolves." It resolves. For the `toml` half the obvious route is
genuinely blocked — `@stellar/stellar-sdk@14.6.1` pins `toml@^3.0.0` and every
fix is 4.x or 5.x, so a `toml` override *there* would be a major bump inside the
passkey signing path. But that is not the only route, and it is not the route
either half needs.

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

`ci.yml:29` and `publish.yml:33` currently run `npm audit --audit-level=critical`
with the comment "Restore to `--audit-level=high` when upstream resolves." Upstream
resolves; nothing in the tree has to. Two changes follow:

1. **Neither advisory needs to be carried.** Both routes above are in-range
   lockfile-level or minor-bump changes. Once they land, the allowlist is empty
   and the gate returns to a bare `npm audit --audit-level=high` — with the
   `high` floor restored for the *next* new advisory, which `--audit-level=critical`
   does not give.
2. **The `smol-toml` reachability argument must be corrected regardless.** It is
   the more serious of the two highs and it is on the production path, so the
   dev-chain justification cannot be used for it. A wrong justification is worse
   than an honest narrow one, because the next person to re-check will trust it.

An empty allowlist with a dated re-check is still worth keeping: it is what makes
"no high advisories" a checked fact rather than the absence of a check.

## The precedent

`overrides: { "fast-uri": "3.1.7" }` (`package.json:135-136`) already closed four
high-severity advisories on a transitive path with a single line and no
package-range change. The `smol-toml` recommendation is that same move one
severity class away, and the reason the two `toml` advisories are NOT is a range,
not a policy: `@stellar/stellar-sdk@14.6.1` pins `toml@^3.0.0`, so 4.x is a major
bump. `GHSA-hrr3-gc8f-f4qj` now reports against `node_modules/ajv/node_modules/fast-uri`
(moderate) because that is a *different*, nested copy the root override does not
reach — the same shape of gap as smol-toml, one severity down, and the reason the
allowlist entries need node paths rather than just names.
