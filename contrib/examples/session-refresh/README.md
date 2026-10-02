# Session Store refresh() Return Shape (#213)

Demonstrates the documented return shape of the SDK session store's `refresh()`
method. `refresh()` re-reads the persisted session from storage (e.g. when the
tab regains focus or another tab updated it) and resolves to a
`SessionRefreshResult` — `{ session, status }` — so consumers can switch on the
outcome instead of guessing.

> **Note (contributor scope):** per
> [CONTRIBUTING.md](../../../CONTRIBUTING.md) this example cannot edit
> `src/session.ts`, so it re-creates the shape and semantics faithfully in a
> self-contained file. The software change implementing the documented
> `refresh()` return type in the SDK lives in the main source tree and must be
> made by a maintainer.

## Return Shape

`refresh(): Promise<SessionRefreshResult>`, where:

```typescript
interface SessionRefreshResult {
  session: WalletSession | null;
  status: SessionStatus;
}

type SessionStatus = "loading" | "connected" | "disconnected";
```

Possible outcomes:

| Storage state              | Resolved value                                |
| -------------------------- | --------------------------------------------- |
| Valid session persisted    | `{ session, status: "connected" }`            |
| Empty / malformed          | `{ session: null, status: "disconnected" }`   |
| Unreadable (load() throws) | `{ session: null, status: "disconnected" }`   |

`refresh()` **never rejects** — unreadable storage resolves to `disconnected`
rather than throwing.

## Usage

```ts
import { createSessionStore, createMemoryStorage } from "./session-refresh";

const store = createSessionStore(createMemoryStorage(somePersistedSession));

const { session, status } = await store.refresh();
if (status === "connected" && session) {
  console.log("resumed", session.accountId);
} else {
  console.log("no usable session");
}
```

For the full SDK session lifecycle (create → persist → restore/reconnect →
refresh) see
[Sessions & reconnect](https://docs.vellar.xyz/docs/how-it-works#sessions--reconnect).

## Run it

```sh
npx tsx contrib/examples/session-refresh/session-refresh.ts
```

## Tests

```sh
npx vitest run contrib/examples/session-refresh
```