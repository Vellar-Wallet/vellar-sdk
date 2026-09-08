# MCP Payer

An MCP server that lets an AI agent pay for x402 resources on Stellar. Runs
locally over stdio, holds exactly one key.

## Install

```json
{
  "mcpServers": {
    "vellar-x402-payer": {
      "command": "npx",
      "args": ["-y", "vellar-mcp-x402-payer"],
      "env": {
        "VELLAR_X402_SECRET_FILE": "/run/secrets/x402-payer-key",
        "VELLAR_X402_ASSETS": "<assetContractId>:<sessionCeiling>",
        "VELLAR_X402_NETWORK": "testnet"
      }
    }
  }
}
```

## Three tools

**`x402_quote`** — ask what a resource costs before paying. No payment made.

**`x402_pay`** — pay and return the content.

**`x402_session_budget`** — report remaining budget and active limit mode.

## Two budget layers

**Layer 1 — process-level ceiling** (env var configured, resets on restart).
Defence against mistakes — typos, runaway loops.

**Layer 2 — on-chain spending policy** (`VELLAR_X402_WALLET` + a Vellar smart
account). Enforced in `__check_auth` by consensus. Only layer 2 is defence
against a compromised agent.

The policy validates token and amount, not recipient. Do not describe the
process-level ceiling as an on-chain limit.

## Discovery vs payment

| | `vellar-facilitator-discovery` | `vellar-mcp-x402-payer` |
| --- | --- | --- |
| Role | Find resources | Pay for them |
| Holds keys | No | Yes (one) |
| Tools | list, search | quote, pay, budget |

The [discovery server](./facilitator.md#mcp-discovery-server) deliberately holds
no keys. An agent connects to both: one to find resources, this one to pay for
them.
