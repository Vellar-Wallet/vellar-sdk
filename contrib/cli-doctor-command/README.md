# CLI Doctor Command - Implementation Guide

This is a reference implementation guide for issue #605: "Add a vellar doctor command that checks environment readiness in one pass".

## Overview

The `vellar doctor` command should check a user's environment in a single pass, identifying missing Node.js version, unreachable facilitator, or absent signer key before other commands fail.

## Requirements

- Add a `doctor` command to `packages/cli/src/bin.ts`
- Check Node.js version against `engines` field in `packages/cli/package.json` (currently: `node: >=20`)
- Check reachability of configured/default facilitator URL
- Check for presence of signer key without printing the key
- Print pass/fail summary line per check and exit non-zero if any fails
- Add unit tests for happy path and key failure modes
- Follow existing code style and error-handling conventions

## Implementation Details

### 1. Command Structure

The command should be added as a new module following the factory pattern used by existing commands (search, quote, pay, inspect).

**File: `packages/cli/src/commands/doctor.ts`**

Export a `makeDoctorCommand()` function that returns a `Command` instance configured with:
- Command name: `"doctor"`
- Description: `"Check environment readiness for vellar CLI"`
- Options:
  - `--secret <key>`: Payer secret key (optional, for testing signer presence)
  - `--secret-file <path>`: Path to secret key file (optional)
  - `--facilitator <url>`: Facilitator URL (default: `VELLAR_FACILITATOR_URL` env var or `https://vellar-facilitator.onrender.com`)

### 2. Check Functions

Implement three exported check functions (for testing and reusability):

#### `checkNodeVersion(): { pass: boolean; message: string }`

- Parse `process.version` (e.g., "v20.10.0")
- Extract major version number (first digit after "v")
- Compare against `REQUIRED_NODE_VERSION = 20`
- Return `{ pass: true, message: "..." }` if >= 20
- Return `{ pass: false, message: "..." }` if < 20
- Message should include current version and requirement

**Example output:**
```
Node.js version v20.10.0 (required: >=20) ✓
Node.js version v18.5.0 is below required 20 ✗
```

#### `checkFacilitatorReachability(url: string): Promise<{ pass: boolean; message: string }>`

- Make a `HEAD` request to the facilitator URL
- Accept any 2xx, 3xx, or 4xx response as "reachable"
- Treat 5xx as unreachable (server error)
- Catch network errors and report them
- Return `{ pass: true, message: "..." }` on success
- Return `{ pass: false, message: "..." }` on failure

**Logic:**
```typescript
try {
  const response = await fetch(url, { method: "HEAD" });
  if (response.status >= 500) {
    // Server error — consider it unreachable
    return { pass: false, message: `Facilitator returned ${response.status}` };
  }
  return { pass: true, message: `Facilitator is reachable at ${url}` };
} catch (err) {
  return { pass: false, message: `Could not reach facilitator: ${err.message}` };
}
```

**Example output:**
```
Facilitator is reachable at https://vellar-facilitator.onrender.com ✓
Could not reach facilitator: ECONNREFUSED ✗
```

#### `checkSignerKey(opts: { secret?: string; secretFile?: string }): Promise<{ pass: boolean; message: string }>`

Check for signer key in three places (in order of preference):

1. **`opts.secretFile`** (most preferred)
   - Try to read the file
   - If readable and non-empty, pass
   - If not readable, fail with file error
   
2. **`opts.secret`** (less preferred — shell history risk)
   - If provided and non-empty, pass
   
3. **`process.env.VELLAR_SECRET`** (fallback)
   - If set and non-empty, pass

If all three are absent, fail.

**Critical: Never print the secret key value in any message, even on error.**

**Example output:**
```
Signer key found at ~/.vellar/key ✓
Signer key found in --secret flag ✓
Signer key found in VELLAR_SECRET environment variable ✓
No signer key found (check --secret-file, --secret, or VELLAR_SECRET) ✗
Could not read signer key from ~/.vellar/key: ENOENT ✗
```

### 3. Command Action

The command action should:

1. Call all three check functions (can be sequential or parallel)
2. Collect results into an array with `{ name, pass, message }` objects
3. Print formatted output:
   ```
   Environment checks:
   ✓ Node.js version: Node.js version v20.10.0 (required: >=20)
   ✓ Facilitator reachability: Facilitator is reachable at https://vellar-facilitator.onrender.com
   ✓ Signer key: Signer key found in VELLAR_SECRET environment variable
   ```
4. Exit with code 0 if all checks pass
5. Exit with code 1 if any check fails

**Error handling pattern (matches existing commands):**
```typescript
try {
  // Run checks and print output
  if (!allPassed) {
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```

### 4. Integration

Update these files to register the command:

**`packages/cli/src/bin.ts`:**
```typescript
import { makeDoctorCommand } from "./commands/doctor.js";
// ... in program setup:
program.addCommand(makeDoctorCommand());
```

**`packages/cli/src/index.ts`:**
```typescript
export {
  makeDoctorCommand,
  checkNodeVersion,
  checkFacilitatorReachability,
  checkSignerKey,
} from "./commands/doctor.js";
```

## Testing Strategy

**File: `packages/cli/src/commands/doctor.test.ts`**

Follow existing test patterns from `pay.test.ts`:

### Command Registration Tests
- Verify command name is "doctor"
- Verify no required arguments
- Verify options are registered (--secret, --secret-file, --facilitator)

### Happy Path Tests
- All checks pass → exit 0, print all ✓ markers
- All checks fail → exit 1, print all ✗ markers

### Individual Check Tests

**checkNodeVersion:**
- Passes for Node 20+
- Returns message containing current version

**checkFacilitatorReachability:**
- Passes for 2xx/3xx/4xx responses (use vitest stubGlobal for fetch)
- Fails for 5xx responses
- Fails when fetch throws (network error)
- Makes a HEAD request (verify call arguments)

**checkSignerKey:**
- Passes when --secret-file is readable (mock readFile)
- Fails when --secret-file is not readable
- Passes when --secret is provided
- Passes when VELLAR_SECRET is set
- Fails when none are provided
- Prefers --secret-file over --secret
- Prefers --secret-file over VELLAR_SECRET
- Never prints secret key in messages
- Handles empty file gracefully

### Mocking Patterns

Use vitest's existing patterns:
```typescript
// Mock fetch
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));

// Mock process.exit to throw so tests don't terminate
vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
  throw new Error(`exit:${code}`);
}) as never);

// Mock console output
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

// Mock readFile
const readFile = vi.fn().mockResolvedValue("SDABEL...");
vi.doMock("node:fs/promises", () => ({ readFile }), { virtual: true });

// Cleanup
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.VELLAR_SECRET;
});
```

## Configuration Sources

The command should respect these configuration precedences:

### Facilitator URL
1. `--facilitator <url>` flag
2. `VELLAR_FACILITATOR_URL` env var
3. `DEFAULT_FACILITATOR_URL` constant from `search.ts` (currently: `https://vellar-facilitator.onrender.com`)

### Signer Key
1. `--secret-file <path>` (file-based, preferred)
2. `--secret <key>` (command-line, not preferred)
3. `VELLAR_SECRET` env var (fallback)

## Code Style

Follow patterns from existing commands:

- Use `Command` from `commander` library
- Return `Command` instance from factory function
- Use `.option()` for optional flags
- Use `.action()` async handler
- Handle errors with try-catch
- Print to `console.log()` for output, `console.error()` for errors
- Use `process.exit(1)` for failures
- Never echo secrets in error messages
- Wrap dynamic imports in try-catch (e.g., `await import("node:fs/promises")`)

## Example Usage

```bash
# Check with defaults
$ vellar doctor
Environment checks:
✓ Node.js version: Node.js version v20.10.0 (required: >=20)
✓ Facilitator reachability: Facilitator is reachable at https://vellar-facilitator.onrender.com
✓ Signer key: Signer key found in VELLAR_SECRET environment variable

# Check with custom paths
$ vellar doctor --secret-file ~/.vellar/key --facilitator https://custom-facilitator.example.com
Environment checks:
✓ Node.js version: Node.js version v20.10.0 (required: >=20)
✓ Facilitator reachability: Facilitator is reachable at https://custom-facilitator.example.com
✓ Signer key: Signer key found at ~/.vellar/key

# Failure case (old Node version)
$ vellar doctor
Environment checks:
✗ Node.js version: Node.js version v18.5.0 is below required 20
✓ Facilitator reachability: Facilitator is reachable at https://vellar-facilitator.onrender.com
✓ Signer key: Signer key found in VELLAR_SECRET environment variable
```

## Related Files

- `packages/cli/package.json` — Contains `engines` field with Node version requirement
- `packages/cli/src/commands/search.ts` — Contains `DEFAULT_FACILITATOR_URL` constant
- `packages/cli/src/commands/pay.ts` — Reference for signer key handling and error patterns
- `packages/cli/src/commands/pay.test.ts` — Reference for test patterns and mocking

## Acceptance Criteria

When implementing:

- [ ] Command runs without errors: `vellar doctor`
- [ ] All three checks execute
- [ ] Pass/fail summary is printed for each check
- [ ] Exit code is 0 when all pass, 1 when any fail
- [ ] Secret keys are never printed in output
- [ ] Unit tests pass for all check functions
- [ ] Tests cover happy path and failure modes
- [ ] Code follows existing style conventions
- [ ] Changes integrate with existing CLI architecture
