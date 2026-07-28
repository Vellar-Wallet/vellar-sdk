# vellar-sdk example

A minimal browser app demonstrating the full core flow — **create → connect →
pay → attach a spending-limit policy** — against Stellar testnet, using only
the published `vellar-sdk` package surface (not the SDK's internal `src/`).

This is a teaching artifact, not a product: one HTML page, four buttons, and
a log. See [`src/main.ts`](./src/main.ts) for the whole thing.

## Prerequisites

1. **Node 22+.**
2. **A backend gateway.** `vellar-sdk` never holds relayer/sponsor secrets —
   wallet creation and payment submission are fee-sponsored and must be
   authorized server-side. You need a backend implementing the `/wallet/*`
   routes (and, for the policy step, `/policies/*`) documented in the [root
   README's "Your backend"](../README.md#your-backend) section. Point
   `BACKEND_URL` / `POLICY_API_URL` at the top of `src/main.ts` at it.
3. **A browser with a platform authenticator** (Face ID, Touch ID, Windows
   Hello, or a security key) — wallet creation/connection prompts WebAuthn,
   which only runs in a real browser (this is why the example is a browser
   app, not a CLI script).

## Run it

From the **repository root** first (the example depends on the local SDK
build via `vellar-sdk: file:..`, so it must exist):

```sh
npm install
npm run build
```

Then, from this directory:

```sh
npm install
npm run dev
```

Open the printed local URL, click through **1 → 2 → 3 → 4**, and watch the
log. Every failure is a typed error from the SDK's [error catalog](../README.md#errors)
(`err.name`, e.g. `WalletNotReadyError`), so you'll see exactly what went
wrong instead of an opaque stack trace.

## Repo checks

```sh
npm run typecheck  # tsc --noEmit against the published vellar-sdk types
npm run build      # vite build
```

Both run in CI (`.github/workflows/ci.yml`) so a future SDK API change that
breaks this example is caught, not silently left to rot.
