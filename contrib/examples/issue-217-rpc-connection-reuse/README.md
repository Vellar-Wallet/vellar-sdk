# RPC Connection Reuse Tuning

Self-contained reference for issue [#217](https://github.com/Vellar-Wallet/vellar-sdk/issues/217): configurable keep-alive and connection reuse for the Soroban RPC client, with recommended values per environment.

> Scoped to `contrib/` per [CONTRIBUTING.md](../../../CONTRIBUTING.md) rule 3 — the issue's "note in README" is this file, since external PRs cannot touch the root README.

## Why it isn't an `rpc.Server` option

`rpc.Server`'s options expose only `allowHttp` and `headers` — there is no agent or pool hook. Tuning has to happen one layer down, on the HTTP client the environment provides, and be handed to the RPC client as a wrapped `fetch`.

## Recommended values

### Node

| Setting | Recommended | Why |
| --- | --- | --- |
| `keepAlive` | `true` | Reuse is opt-in in Node. Without it every simulation and submit repeats the TCP + TLS handshake. |
| `keepAliveMsecs` | `30_000` | Stays under the commonly-configured 60s server-side idle timeout, so the client closes first instead of racing a server close (which surfaces as `socket hang up` on a request already in flight). |
| `maxSockets` | `10` | Covers a wallet's concurrent multi-token read burst without opening more connections than a public RPC endpoint tolerates from one client. |
| `maxFreeSockets` | `6` | Keeps the steady-state pool warm between polls. |

Construct the pool yourself and pass it in — the SDK never imports undici:

```ts
import { Agent } from "undici";
import { createTunedRpcTransport, NODE_DEFAULTS } from "./rpc-connection-reuse";

const pool = new Agent({
  keepAliveTimeout: NODE_DEFAULTS.keepAliveMsecs,
  connections: NODE_DEFAULTS.maxSockets,
});

const transport = createTunedRpcTransport({ environment: "node" }, { pool });
// hand transport.fetch to whatever constructs the RPC client
```

The **same** pool instance must be reused across requests — that identity is what makes a socket reusable rather than per-request.

### Browser

Nothing to tune, and attempting to is counterproductive:

- The user agent owns the connection pool and neither exposes nor accepts an agent.
- `Connection` is a [forbidden header name](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name); setting it is stripped or rejected. This module emits no `Connection` header in the browser.
- HTTP/1.1 keep-alive and HTTP/2 multiplexing are already the default.

The only thing a browser consumer controls is not defeating reuse — keep one origin, and don't add cache-busting query params that change it.

## Run tests

```bash
npx vitest run contrib/examples/issue-217-rpc-connection-reuse/rpc-connection-reuse.test.ts
```
