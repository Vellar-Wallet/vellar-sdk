# MCP Payer Health-Check Script (#679)

Reference implementation for a standalone health-check script an operator
could wire into an uptime monitor or process supervisor to detect a hung or
crashed `packages/mcp-x402-payer` instance.

## What It Does

- `healthcheck.ts` spawns the MCP payer binary, sends one JSON-RPC
  `tools/list` request over its stdio transport, and resolves with a result
  carrying one of three distinct exit codes:
  - `0` (HEALTHY): the process answered `tools/list` within the timeout.
  - `1` (UNRESPONSIVE): the process is running but did not answer in time,
    or answered with a JSON-RPC error.
  - `2` (NOT_RUNNING): the process could not be spawned, or exited before
    answering.
- These codes are kept distinct deliberately: a supervisor that sees
  `UNRESPONSIVE` knows a restart is likely to help, while `NOT_RUNNING`
  points at something broken in the binary path, config, or environment
  that a restart alone won't fix.
- Verified end to end against real spawned Node processes exercising each
  of the five scenarios below, not mocked.

## Verification (manually run, see note on CI below)

```
PASS healthy
PASS unresponsive
PASS error-response-is-unresponsive
PASS crashes-is-not-running
PASS missing-binary-is-not-running
ALL PASS
```

## Integration into Core

1. Copy `healthcheck.ts` to `packages/mcp-x402-payer/src/healthcheck.ts` and
   `healthcheck.test.ts` to `packages/mcp-x402-payer/src/healthcheck.test.ts`.
2. Add a `bin` entry to `packages/mcp-x402-payer/package.json`:
   ```json
   "bin": {
     "vellar-mcp-x402-payer": "./dist/bin.js",
     "vellar-mcp-x402-payer-healthcheck": "./dist/healthcheck.js"
   }
   ```
3. Add a small CLI wrapper at the bottom of `healthcheck.ts` (already present
   as `runHealthcheckCli`) invoked from a thin entry script, e.g.:
   ```ts
   #!/usr/bin/env node
   import { runHealthcheckCli } from "./healthcheck.js";
   await runHealthcheckCli();
   ```
4. Document the two supervisor patterns in
   `website/content/docs/operators/`:
   - **systemd watchdog**: a `Type=notify` unit with
     `WatchdogSec=30` pairs naturally with a periodic `ExecReload`-style
     timer that runs the health check and calls `systemctl restart` on a
     non-zero exit.
   - **cron check**: a `* * * * *` cron entry running
     `vellar-mcp-x402-payer-healthcheck -- node dist/bin.js || systemctl restart vellar-mcp-x402-payer`
     is the simplest version, with the exit code distinguishing a restart
     (code 1) from an on-call page (code 2, since a restart won't fix a
     missing binary or bad config).
5. Wire `packages/mcp-x402-payer/src/healthcheck.test.ts` into the existing
   `vitest` config for that package; no new test runner or config is needed.
