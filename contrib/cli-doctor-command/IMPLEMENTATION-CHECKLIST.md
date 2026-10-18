# Doctor Command Implementation Checklist

This checklist tracks the tasks needed to implement issue #605 in the main packages/cli directory.

## Setup

- [ ] Create `packages/cli/src/commands/doctor.ts`
  - [ ] Copy or adapt the reference implementation from `contrib/cli-doctor-command/doctor.ts`
  - [ ] Update import path for `DEFAULT_FACILITATOR_URL` (remove ".js" suffix relative to actual location)
  - [ ] Ensure all three check functions are exported: `checkNodeVersion`, `checkFacilitatorReachability`, `checkSignerKey`
  - [ ] Ensure factory function is exported: `makeDoctorCommand`

- [ ] Create `packages/cli/src/commands/doctor.test.ts`
  - [ ] Copy or adapt the reference test suite from `contrib/cli-doctor-command/doctor.test.ts`
  - [ ] Verify all test cases pass

## Integration

- [ ] Update `packages/cli/src/bin.ts`
  - [ ] Add import: `import { makeDoctorCommand } from "./commands/doctor.js";`
  - [ ] Add to program: `program.addCommand(makeDoctorCommand());`

- [ ] Update `packages/cli/src/index.ts`
  - [ ] Add exports:
    ```typescript
    export {
      makeDoctorCommand,
      checkNodeVersion,
      checkFacilitatorReachability,
      checkSignerKey,
    } from "./commands/doctor.js";
    ```

## Verification

- [ ] Command runs: `vellar doctor`
- [ ] All three checks execute in output
- [ ] Pass/fail markers (✓/✗) are shown for each check
- [ ] Exit code is 0 when all checks pass
- [ ] Exit code is 1 when any check fails
- [ ] Secret keys are never printed in any output
- [ ] Node version check works correctly
- [ ] Facilitator reachability check works with default and custom URLs
- [ ] Signer key check works with all three sources (--secret-file, --secret, VELLAR_SECRET)

## Testing

- [ ] Run: `npm test` (in packages/cli directory)
- [ ] All doctor command tests pass
- [ ] All three check function tests pass
- [ ] No test regressions in other commands

## Code Quality

- [ ] Code matches existing style in pay.ts, search.ts, etc.
- [ ] Error handling follows the try-catch → console.error → process.exit(1) pattern
- [ ] All JSDoc comments are present
- [ ] Type annotations are correct
- [ ] No unused imports
- [ ] Proper async/await usage

## Documentation

- [ ] Update `packages/cli/README.md` with doctor command usage example
  - [ ] Include basic usage: `vellar doctor`
  - [ ] Include custom options: `vellar doctor --secret-file ~/.vellar/key`
  - [ ] Show example output with all checks passing
  - [ ] Show example output with a failed check

- [ ] Ensure reference documentation in `contrib/cli-doctor-command/README.md` is kept in sync

## PR Preparation

- [ ] Create new branch: `git checkout -b feat/cli-doctor-command`
- [ ] Commit changes with descriptive message:
  ```
  Add doctor command for environment readiness checks
  
  - Adds 'vellar doctor' command to check environment in one pass
  - Checks Node.js version against engines field (>=20)
  - Checks facilitator URL reachability via HEAD request
  - Checks for signer key presence (--secret-file, --secret, VELLAR_SECRET)
  - Never prints secret key values in error messages
  - Exits non-zero if any check fails
  - Includes comprehensive unit tests for all happy paths and failure modes
  
  Closes #605
  ```

- [ ] Push branch to remote
- [ ] Create pull request targeting `dev` branch
- [ ] Link to issue #605 in PR description

## Implementation Notes

### File Locations (Reference)
- Implementation guide: `contrib/cli-doctor-command/README.md`
- Reference implementation: `contrib/cli-doctor-command/doctor.ts`
- Reference tests: `contrib/cli-doctor-command/doctor.test.ts`

### Key Requirements from Issue #605
1. Check Node.js version against `engines` field in package.json
2. Check reachability of facilitator URL (configured or default)
3. Check for signer key presence without printing the key
4. Print pass/fail summary line per check
5. Exit non-zero if any check fails
6. Add unit tests for happy path and failure modes
7. Follow existing code style and error-handling conventions
8. Integrate with real schema fields
9. PR targets dev branch
10. Reviewed and approved by maintainer before merge

### Design Decisions
- Node version check uses `parseInt(process.version.slice(1).split(".")[0])` to extract major version
- Facilitator check treats 5xx as unreachable, other statuses as reachable
- Signer key check prefers --secret-file over --secret over VELLAR_SECRET
- Output uses ✓/✗ markers for clarity
- Exit code 0 when all pass, 1 when any fail (follows existing pattern)
- Never echoes secret values in any message (security best practice)
