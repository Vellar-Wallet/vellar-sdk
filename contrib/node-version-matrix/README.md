# Consistent Node.js support matrix

The workspace CLI and MCP payer already declare `engines.node: ">=20"`; the
root SDK currently omits the field. This contribution provides the executable
consistency gate and the exact maintainer-owned changes needed to establish
Node.js 20 as the tested floor without editing files outside `contrib/`.

## Check

```sh
node contrib/node-version-matrix/check-node-engines.mjs
npx vitest run contrib/node-version-matrix/check-node-engines.test.ts
```

The first command intentionally fails on the current checkout until the root
package adopts the proposed `engines` field. It then verifies that every
workspace package declares exactly the same range and prints the oldest Node
major CI must run.

## Maintainer integration

1. Merge `root-package-engines.json`'s `engines` object into the root
   `package.json`. The existing CLI and MCP declarations already match.
2. Add `ci-oldest-node.yml` as a job in `.github/workflows/ci.yml`. It runs the
   same typecheck, documentation check, tests, and build as the primary job on
   Node.js 20.
3. Add `root-readme-section.md` once to the root README. Package READMEs should
   link to that section rather than maintaining separate version claims.
4. Run the checker in both CI jobs after `npm ci`.

These fragments are separated because `CONTRIBUTING.md` reserves root package,
workflow, and root README changes for maintainers.
