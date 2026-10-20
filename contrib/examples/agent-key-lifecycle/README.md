# Agent-key mint and revoke lifecycle

This framework-free example wires `wallet.agents` to a mock `AgentKeyRuntime`,
mints an ed25519 agent key with both a spending-limit and verified-only policy,
uses the key once, revokes it, and proves a later signing attempt fails. It does
not require a passkey, funded account, or live chain.

```sh
npx tsx contrib/examples/agent-key-lifecycle/agent-key-lifecycle.ts
npx vitest run contrib/examples/agent-key-lifecycle/agent-key-lifecycle.test.ts
```

The mock runtime models the lifecycle boundary only. Production runtimes must
implement `addAgentKey` and `removeAgentKey` through the passkey-authorized
wallet administration flow; the private agent key must remain with the agent.
