# VS Code Extension

The **Vellar x402** extension adds x402 payment gating to an HTTP endpoint in
one command — without leaving your editor.

## Install

Search **Vellar x402** in the VS Code Extensions panel, or install from the
command line:

```sh
code --install-extension VellarWallet.vellar-x402
```

[VS Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=VellarWallet.vellar-x402)

## What it does

Open any file containing route definitions, then run the command:

```
Vellar: Add x402 payment to this endpoint
```

The extension:

1. Scans the open file for route definitions.
2. Lets you pick a route.
3. Asks how much to charge in USDC.
4. Injects working boilerplate that:
   - returns a 402 challenge for unpaid requests,
   - verifies and settles via the Vellar facilitator,
   - reads your payout address from VS Code settings.

Your existing route logic is untouched — the payment gate wraps the handler,
it doesn't replace it.

## Supported frameworks

| Framework | Support |
| --- | --- |
| Express | Full |
| Fastify | Full |
| Next.js App Router | Full |
| Next.js Pages Router | Detected, not injected |

## What gets injected

The extension wires `@x402/stellar`'s `ExactStellarScheme` and points it at the
Vellar facilitator (`https://vellar-facilitator.onrender.com`). Your `payTo`
address comes from VS Code settings — never hardcoded.

The injected code is the same boilerplate you would write by hand following the
[seller guide](./facilitator.md).
