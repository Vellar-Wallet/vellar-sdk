# Spending Policy Recipient Disclosure

Standalone reference for issue #514. The existing `honesty.md` disclosure remains authoritative and unchanged. This contribution shows where the same caveat belongs when changes to the shipped API reference and source TSDoc are allowed.

## API reference placement

Place this beside the `wallet.agents.mint()` example and beside the spending-limit policy deployment instructions:

> **Recipient limitation:** A spending-limit policy validates the token and amount, but does not constrain the recipient. A payment redirected to another address within the cap still satisfies the policy. Validate the intended recipient in your application.

## TSDoc placement

Attach the caveat directly to the grant policy field and the `MintAgentInput.grants` field so it appears while constructing a mint request:

```ts
export interface AgentPolicyGrant {
  token: string;
  /**
   * Policies required for this token. A spending-limit policy checks the token
   * and amount, not the recipient; a redirected payment within the cap still
   * satisfies it. Validate the intended recipient in your application.
   */
  policies: string[];
}

export interface MintAgentInput {
  publicKey: string;
  /**
   * Token grants. Spending-limit policies in these grants do not constrain the
   * recipient; validate the intended recipient in your application.
   */
  grants: AgentPolicyGrant[];
}
```

## Integration

Copy the disclosure beside the wallet agent-key mint example and the spending-limit deployment API reference. Add the TSDoc to the owning exported config/input types. Do not replace or weaken the audit V-1 wording in `honesty.md`.