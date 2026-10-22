# Vellar policies vs native Stellar multisig (doc page)

`policies-vs-multisig.md` compares a Vellar programmable policy with native
Stellar account multisig on threshold semantics, revocation speed and
agent-key composability, with a use-case decision guide.

## Integration into core
1. Copy `policies-vs-multisig.md` to `website/content/docs/architecture/`.
2. Register it in `website/lib/docs-registry.ts` (this repo has no `meta.json`;
   the registry drives navigation), before `architecture/threat-model`:
   ```ts
   { slug: "architecture/policies-vs-multisig", title: "Policies vs Stellar Multisig", nav: "Policies vs Multisig",
     section: "Architecture", tab: "architecture",
     description: "When to use a Vellar programmable policy versus native Stellar multisig thresholds and signer weights." },
   ```
3. `policies-vs-multisig.test.ts` already resolves the page's relative links
   from `architecture/`.
