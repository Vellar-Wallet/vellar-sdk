# Minimal MCP Client Wired to `vellar-mcp-x402-payer` over Stdio (`#632`)

> **SECURITY NOTE — NON-PRODUCTION TEST KEYPAIR ONLY**
> This example generates a fresh throwaway Stellar keypair (`Keypair.random()`) at runtime. No secret seed is stored in the repository, and the generated keypair is strictly for local/CI demonstration. In production, supply your payer key via `VELLAR_X402_SECRET_FILE` (or `VELLAR_X402_SECRET`) from a secure secret manager, and never pass secrets through MCP tool arguments.

## Overview

`packages/mcp-x402-payer` exposes four MCP tools over `stdio` (`x402_quote`, `x402_pay`, `x402_pay_and_call`, and `x402_session_budget`). This contrib example demonstrates how an application or agent host can spawn the MCP payer server as a child process over `stdio` and drive it using `@modelcontextprotocol/sdk`:

1. **Throwaway Test Keypair (`createThrowawayTestKeypair`)**: Generates an ephemeral Ed25519 keypair at runtime so zero secrets exist in source control.
2. **Mock Facilitator / Resource Server (`startMockFacilitatorResourceServer`)**: Serves an HTTP 402 `PAYMENT-REQUIRED` challenge on the first `GET /resource` and returns an HTTP 200 response with a base64 `X-PAYMENT-RESPONSE` settlement header on the signed retry, reusing the test fixtures from `packages/mcp-x402-payer/test/helpers.ts`.
3. **MCP Handshake & Tool Calls (`runMcpPayerClientExample`)**:
   - Spawns the MCP payer child process via `StdioClientTransport`.
   - Performs the MCP `initialize` (`client.connect`) and `tools/list` (`client.listTools`) handshake.
   - Calls `x402_quote` to inspect the resource price without signing.
   - Calls `x402_pay` with `max_amount` to sign and settle the x402 challenge and receive the fenced untrusted content.
   - Calls `x402_session_budget` before and after payment to verify the session spend ledger deduction.

## Running the Example

```bash
npx tsx --conditions=source contrib/mcp-payer-client/index.ts
```

## Running the Tests

```bash
npx vitest run contrib/mcp-payer-client/index.test.ts
```
