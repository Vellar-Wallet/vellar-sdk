# Lightweight logging wrapper

A minimal `info`/`warn`/`error` logger with a global `setSilent` switch —
useful for keeping test output clean without stripping log calls out of the
code under test, or for a CLI's `--quiet` flag.

## Usage

```ts
import { info, warn, error, setSilent } from "./lightweight-logger";

info("Starting up");        // [INFO] Starting up
warn("Cache miss");         // [WARN] Cache miss
error("Request failed");    // [ERROR] Request failed

setSilent(true);
info("This produces no output at all");
setSilent(false);
```

## Run it

```sh
npx tsx lightweight-logger.ts
```

Expected output:

```
[INFO] Starting up
[WARN] Cache miss, falling back to network
[ERROR] Request failed after 3 retries
--- now silenced ---
[INFO] Logging resumed
```

(Nothing prints between the `--- now silenced ---` line and `Logging resumed`.)

## Tests

```sh
npx vitest run contrib/examples/lightweight-logger
```
