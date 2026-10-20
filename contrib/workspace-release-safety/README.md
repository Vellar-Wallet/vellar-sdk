# Workspace Release Safety Proposal

This contributor-sandbox package provides executable reference checks and an
integration recipe for issues #623, #624, #625, and #628. Repository policy
allows contributor changes only under `contrib/`, so this directory does not
edit root scripts, workflows, package manifests, or package READMEs. The
"Maintainer integration" sections name every required outside-`contrib` change.

## Run the reference checks

```sh
node contrib/workspace-release-safety/dependency-drift.mjs .
node contrib/workspace-release-safety/readme-package-name.mjs .
npx vitest run contrib/workspace-release-safety
```

The standalone installation harness needs built package artifacts and network
access for declared npm dependencies:

```sh
npm run build
npm run build --workspace vellar-cli
npm run build --workspace vellar-mcp-x402-payer
node contrib/workspace-release-safety/standalone-install.mjs packages/cli .
node contrib/workspace-release-safety/standalone-install.mjs packages/mcp-x402-payer .
```

## #624: workspace dependency drift

`dependency-drift.mjs` reads the root package name/version and every manifest
matched by the root `workspaces` field. It checks the declared `vellar-sdk`
range in dependencies, peers, optional dependencies, or dev dependencies.

The result distinguishes:

- `incompatible`: the current root version is excluded by the workspace range;
- `stale-minimum`: the range still includes the root version, but its declared
  minimum is behind the root version;
- `aligned`: the current version is included and the minimum is current.

This distinction matters for the reported fixture. npm semver says `^0.6.1`
includes `0.6.2`; it is not an exclusion. It is still drift because the minimum
advertised by `vellar-mcp-x402-payer` is stale. The default CLI fails for both
incompatible ranges and stale minimums, so the current real-data fixture proves
the drift gate fires without misdescribing caret behavior. Tests also cover a
future `0.7.0` root version that is genuinely excluded by `^0.6.2`.

### Maintainer integration

1. Add this root script to `package.json`:

   ```json
   "check:workspace-dependency-drift": "node contrib/workspace-release-safety/dependency-drift.mjs ."
   ```

2. Run `npm run check:workspace-dependency-drift` in `.github/workflows/ci.yml`
   after `npm ci` and before builds.
3. Update `packages/mcp-x402-payer/package.json` from `^0.6.1` to `^0.6.2` in
   the maintainer integration commit. No manifest is changed by this proposal.

## #623: consistent Changesets changelogs

`proposed-changesets-config.json` is ready to copy to
`.changeset/config.json`. It targets `dev`, publishes public packages, and
bumps internal dependency ranges at patch releases. The existing detailed root
`CHANGELOG.md` must remain byte-for-byte intact when Changesets is adopted;
Changesets appends later generated sections rather than replacing history.

The files under `proposed-changelogs/` establish non-fabricated baselines for
the CLI (`0.1.1`) and MCP payer (`0.1.5`). They intentionally make no claims
about unrecorded historical details. Future entries are generated from
changesets.

### Maintainer integration

1. Add `@changesets/cli` as a root dev dependency.
2. Copy `proposed-changesets-config.json` to `.changeset/config.json`.
3. Copy the proposed package changelogs to
   `packages/cli/CHANGELOG.md` and
   `packages/mcp-x402-payer/CHANGELOG.md`.
4. Add root scripts:

   ```json
   "changeset": "changeset",
   "version-packages": "changeset version",
   "release-packages": "changeset publish"
   ```

5. Wire the existing `contrib/validate-changeset.mjs` into pull-request CI so
   source/package changes require a `.changeset/*.md` entry.
6. Document this release sequence in `CONTRIBUTING.md`: create a changeset,
   merge to `dev`, run `npm run version-packages`, review all version/range and
   changelog updates, merge the release PR, then publish from the protected
   release workflow.

## #625: standalone package installation

`standalone-install.mjs` packs the local root SDK and one workspace package,
installs only those tarballs into a new temporary consumer, validates that the
published entry points are present, and runs the package smoke behavior:

- `vellar-cli`: executes `vellar --help` and requires exit code 0;
- `vellar-mcp-x402-payer`: starts with all credential variables removed and
  requires the documented configuration guard. Reaching that guard proves all
  runtime imports loaded without starting a long-lived server or using a key.

The clean consumer is outside the npm workspace and cannot see hoisted root
dev dependencies. The local SDK tarball is installed explicitly so the smoke
test uses the revision under review rather than a stale registry version.

### Maintainer integration

Add a job like this to `.github/workflows/ci.yml`:

```yaml
  standalone-package:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        package-directory:
          - packages/cli
          - packages/mcp-x402-payer
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run build --workspace vellar-cli
      - run: npm run build --workspace vellar-mcp-x402-payer
      - run: node contrib/workspace-release-safety/standalone-install.mjs ${{ matrix.package-directory }} .
```

Add this sentence to both package READMEs beside their install instructions:

> Standalone package installation is validated with `@stellar/stellar-sdk`
> `^16.0.1` on Node.js 22.

The root install builds artifacts, but the actual consumer install is isolated
in a fresh temporary directory. A package that imports an undeclared module
there fails with a module-resolution error.

## #628: README package-name consistency

`readme-package-name.mjs` inspects shell code fences containing `npm install`,
`npm i`, or `npm add`, normalizes versioned/scoped specifiers, and verifies that
each README names its own manifest package. It checks the root plus every
workspace, and exits nonzero on a rename mismatch. The tests include the
requested stale-name failure fixture and guard against accepting prose or an
`npx` command as installation documentation.

### Maintainer integration

1. Add this root script:

   ```json
   "check:readme-package-names": "node contrib/workspace-release-safety/readme-package-name.mjs ."
   ```

2. Run it in `.github/workflows/ci.yml` after `npm ci`.

## Files intentionally not changed

The following required integration targets remain untouched under the
contributor rule: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`,
`CONTRIBUTING.md`, `CHANGELOG.md`, `README.md`, and all files under `packages/`.
