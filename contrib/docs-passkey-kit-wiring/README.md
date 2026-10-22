# AgentKeyRuntime passkey-kit wiring (doc page)

`passkey-kit-wiring.md` documents the `AgentKeyRuntime` contract and a
~15-line reference implementation wired to a real `PasskeyKit`, covering
`addAgentKey`, `removeAgentKey` and the optional `resume`.
`passkey-kit-wiring.test.ts` runs the same wiring against a fake kit (happy
path, resume handling, dismissed prompt, backend failure) and checks the page's
links.

## Integration into core
1. Copy `passkey-kit-wiring.md` to `website/content/docs/agent-tooling/` and
   register it in `website/lib/docs-registry.ts` (before `agent-tooling/policies`):
   ```ts
   { slug: "agent-tooling/passkey-kit-wiring", title: "Wiring AgentKeyRuntime to PasskeyKit", nav: "PasskeyKit wiring",
     section: "Agent Tooling", tab: "guides",
     description: "The exact AgentKeyRuntime contract and a reference implementation wired to a real PasskeyKit." },
   ```
2. Cross-link from `agent-keys.md`: after the sentence ending "...wired on the
   host side." add "For the full method contract and a typechecked reference
   implementation, see [Wiring AgentKeyRuntime to PasskeyKit](./passkey-kit-wiring.md)."
   and add it to that page's "Next steps".
3. Typecheck the example with `scripts/check-doc-snippets.mjs`: add the page to
   `PAGES` and give it a `PREAMBLES` entry declaring the host-owned names with
   their real types:
   ```ts
   declare const kit: import("passkey-kit").PasskeyKit;
   declare const backend: import("vellar-sdk").WalletBackend & {
     submitTransaction(input: { signedXdr: string; network: import("vellar-sdk").Network }): Promise<{ hash: string }>;
   };
   declare const sac: import("vellar-sdk").SacClientLike;
   declare const isValidAddress: (address: string) => boolean;
   ```
   The checker's `export const agentKeys: AgentKeyRuntime` then fails if the
   example drifts from the real interface or from `PasskeyKit`'s methods.
