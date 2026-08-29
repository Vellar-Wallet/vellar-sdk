# Verification Status Poller

A self-contained reference example that polls a mock verification job until it
reaches a terminal state (`verified` or `failed`), with a configurable maximum
wait time.

## Flow

1. `pollVerificationStatus(jobId, fetcher, options)` starts an interval loop.
2. On each tick it calls `fetcher(jobId)` to retrieve the current job.
3. If the job status is `'verified'` or `'failed'` the promise resolves with
   the final `VerificationJob`.
4. If `maxWaitMs` elapses before a terminal status is reached, the promise
   rejects with a descriptive timeout error.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `intervalMs` | `1000` | Polling interval in milliseconds |
| `maxWaitMs` | `30000` | Maximum total wait before rejection |

## Files

| File | Purpose |
|------|---------|
| `verification-status-poller.ts` | Core `pollVerificationStatus` implementation |
| `demo.ts` | Script showing both success and timeout paths |

## Running the demo

```bash
npx ts-node demo.ts
```

Expected output:

```
--- Success path ---
Job resolved: status=verified

--- Timeout path ---
Correctly rejected: Verification job job-002 timed out after 1000ms
```
