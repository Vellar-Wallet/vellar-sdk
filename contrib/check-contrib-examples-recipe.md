# Recipe: CI Job to Build and Typecheck Every Contrib Example (#631)

## Overview

This document describes how to implement a CI job that validates every example in `contrib/` and `contrib/examples/` by running typecheck and build steps. The job ensures examples stay in sync with the SDK as it evolves.

## Requirements

1. **Discover all examples**: Iterate every directory under `contrib/` and `contrib/examples/`.
2. **Filter by configuration**: Only check examples that have a `package.json` or `tsconfig.json`.
3. **Typecheck**: Run `tsc --noEmit` using the example's `tsconfig.json`, or fall back to the root config.
4. **Build**: Run `npm run build` if the example's `package.json` defines a build script.
5. **Fail fast**: Stop at the first failure, clearly reporting which example and which step failed.
6. **Exit codes**: Return 0 on success, 1 on any failure.
7. **CI integration**: Add a separate job to `.github/workflows/ci.yml` so build failures are distinguishable from test failures.
8. **Script**: Implement the logic in a script (e.g., `scripts/check-contrib-examples.mjs`) so it can be:
   - Run locally for development
   - Tested with unit tests
   - Called from CI
9. **Unit tests**: Cover all requirements, mocking filesystem and child process execution.
10. **Documentation**: Update `contrib/README.md` with instructions on running the script locally.

## Implementation Strategy

### 1. Script Structure (`scripts/check-contrib-examples.mjs`)

**Purpose**: Orchestrate the discovery, typecheck, and build of all examples.

**Key functions**:

- **`findExamplesToCheck()`**: 
  - Recursively list `contrib/` and `contrib/examples/`
  - For each directory, check if `package.json` or `tsconfig.json` exists
  - Return an array of `{ path, name, hasPackageJson, hasTsConfig }`
  - Skip any directory with neither file

- **`runTypecheck(example)`**:
  - If `example.hasTsConfig`, run `tsc --noEmit -p <example-path>`
  - Otherwise, run `tsc --noEmit -p <root-path>` (fall back to root config)
  - Return `{ success: true }` or `{ success: false, error }`

- **`runBuild(example)`**:
  - Only if `example.hasPackageJson`
  - Parse `package.json` to check for a `build` script
  - If no script exists, return `{ success: true, skipped: true }`
  - Otherwise, run `npm run build` from the example directory
  - Return `{ success: true }` or `{ success: false, error }`

- **`main()`**:
  - Call `findExamplesToCheck()` to get the list
  - For each example, call `runTypecheck()` then `runBuild()` if applicable
  - On first failure, record the example name and failed step, then break
  - If failures occurred, print a clear error message and exit with code 1
  - If all pass, print success message and exit with code 0

**Error reporting format**:
```
❌ FAILED: <example-name> failed <typecheck|build>
```

**Logging output** (stderr for errors, stdout for progress):
```
ℹ️  Found N example(s) to check

🔍 Checking <example-name>...
   • Typecheck...
     ✓ Typecheck passed
   • Build...
     ✓ Build passed

✅ All N example(s) passed typecheck and build
```

### 2. CI Workflow Job (`.github/workflows/ci.yml`)

**Add a new job** called `check-contrib-examples` (alongside, not within, the existing `ci` job).

**Job definition**:
```yaml
check-contrib-examples:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: node scripts/check-contrib-examples.mjs
```

**Rationale**:
- Separate job so build/typecheck failures in examples don't mask test failures
- Same Node version (22) and caching as the main CI job
- Uses `npm ci` to install dependencies consistently

### 3. Unit Tests (`scripts/check-contrib-examples.test.ts`)

**Framework**: Vitest (already used in the project)

**Mocking strategy**:
- Mock `node:fs` (`readdirSync`, `statSync`, `existsSync`, `readFileSync`)
- Mock `node:child_process` (`execFileSync`)
- Avoid real filesystem and process spawning—tests run fast and deterministically

**Test suites**:

1. **Happy path**:
   - All examples pass typecheck and build
   - Correct number of examples processed

2. **Example structure**:
   - Examples with only `package.json`
   - Examples with only `tsconfig.json`
   - Examples with both files
   - Directories with neither file are skipped

3. **Failure handling**:
   - Typecheck failure stops at first example, reports name and "typecheck" step
   - Typecheck failure does not run later examples
   - Build failure stops at first example, reports name and "build" step
   - Build failure does not run later examples

4. **Build script handling**:
   - Skip build when `package.json` has no build script
   - Build only runs for examples with `package.json`

5. **Typecheck variants**:
   - Use example's `tsconfig.json` when present
   - Fall back to root `tsconfig.json` when example has no config
   - Always include `--noEmit` flag

6. **Exit codes**:
   - Exit 0 on success
   - Exit 1 on typecheck failure
   - Exit 1 on build failure
   - Exit 0 when no examples found (warning message, not an error)

7. **Error reporting**:
   - Error message clearly states which example failed and which step
   - Later examples are not attempted after first failure

8. **Empty/missing contrib**:
   - Handle gracefully when no examples are found
   - Handle gracefully when `contrib/` is missing

### 4. Documentation Update (`contrib/README.md`)

**Add a new section** at the top (before the numbered issues):

```markdown
## CI: Building and Typechecking Contrib Examples

Every example subdirectory in `contrib/` and `contrib/examples/` that contains a `package.json` or `tsconfig.json` is automatically checked in CI.
The script runs `tsc --noEmit` for typecheck and `npm run build` (if the script exists) for each example that requires it.

### Manual Run
To check all contrib examples locally:
```sh
node scripts/check-contrib-examples.mjs
```

The script will:
- Iterate through each example directory
- Typecheck using the example's `tsconfig.json` or fall back to the root config
- Run the `build` script if `package.json` defines one
- Fail fast on the first error, reporting which example and which step failed
- Exit with code 0 if all examples pass, or 1 if any fail

See `.github/workflows/ci.yml` for the `check-contrib-examples` job that runs this on every push and PR.
```

## Integration Checklist

- [ ] Create `scripts/check-contrib-examples.mjs` with the logic above
- [ ] Create `scripts/check-contrib-examples.test.ts` with all test cases
- [ ] Add `check-contrib-examples` job to `.github/workflows/ci.yml`
- [ ] Update `contrib/README.md` with the manual run instructions
- [ ] Run `npm test` locally to verify all tests pass
- [ ] Run `node scripts/check-contrib-examples.mjs` locally to verify the script works
- [ ] Verify the full CI suite passes (typecheck, tests, build, lint)
- [ ] Create PR targeting `dev` branch

## Notes

### Why a Script Over a Makefile or Shell Command?

A script (`check-contrib-examples.mjs`) is better than embedding logic directly in the CI job YAML because:
- Reusable: Run locally for development, same logic in CI
- Testable: Unit tests can mock filesystem and processes, no need for integration tests
- Maintainable: Change the script once, not twice (local + CI)
- Clear: Script logic is easier to read than nested YAML syntax

### Why Separate from the Main Test Job?

Examples can fail for different reasons than the SDK itself:
- An example may have outdated imports after an SDK refactor
- A build script may fail due to dependencies
- These are distinct concerns from unit test failures

Separating the job makes it easy to:
- Quickly spot which examples are broken in CI output
- Allow the main test job to pass while examples are being fixed
- Future: Add a "contrib-examples-only" workflow that can be triggered manually for debugging

### Why Fall Back to Root tsconfig.json?

Most examples in `contrib/examples/` are small, self-contained TypeScript files with no own `tsconfig.json`. They should typecheck against the root configuration to ensure they:
- Use the same compiler settings as the main SDK
- Don't drift into incompatible code patterns

Standalone contrib directories (like `coverage-runner`) can provide their own `tsconfig.json` if they need different settings.

### Exit Code Convention

- **0**: All examples pass (or no examples to check—this is not a failure)
- **1**: Any example fails to typecheck or build

This matches the convention used by other scripts in the project (e.g., `scripts/check-doc-snippets.mjs`).

## Future Enhancements

- **Parallel execution**: Currently sequential for clarity. If there are many examples, run them in parallel with a queue to avoid spawning too many processes.
- **Caching**: Cache node_modules across runs to speed up builds in CI (already handled by `actions/setup-node`).
- **Filtering**: Add a `--only <pattern>` flag to check only examples matching a name pattern, for faster local iteration.
- **Reporting**: Generate a JSON report of all examples and their status for downstream tools to consume.
