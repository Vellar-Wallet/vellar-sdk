// Standalone example: call a mocked policies.listTemplates() and print the
// results. See ./README.md for how this maps to the real policies API.

import { createPolicyClient } from "../../../src/policy-client";
import type { PolicyTemplateInfo } from "../../../src/policy-types";

const MOCK_TEMPLATES: PolicyTemplateInfo[] = [
  {
    type: "spending-limit-daily",
    title: "Daily spending limit",
    description:
      "Caps total spend per rolling 24h window; enforced on-chain by a deployed policy contract.",
    enforcement: { kind: "policy-contract", wasmHash: "mock-wasm-hash-spending-limit" },
  },
  {
    type: "session-key-only",
    title: "Session-key signer limits",
    description:
      "Restricts a session key to a fixed set of contract calls; enforced by the wallet's signer limits, no separate contract deployed.",
    enforcement: { kind: "signer-limits" },
  },
  {
    type: "unrestricted",
    title: "No policy",
    description: "No spending restriction is attached; the wallet's normal signer thresholds apply.",
    enforcement: { kind: "none" },
  },
];

/** A `fetch` stand-in that serves `MOCK_TEMPLATES` for GET /policies/templates
 * and 404s everything else — enough to drive `createPolicyClient` without a
 * real gateway. */
function mockPoliciesFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/policies/templates")) {
      return new Response(JSON.stringify(MOCK_TEMPLATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

export async function listPolicyTemplates(): Promise<PolicyTemplateInfo[]> {
  const client = createPolicyClient({
    apiUrl: "https://example-gateway.invalid",
    network: "testnet",
    fetch: mockPoliciesFetch(),
  });
  return client.listTemplates();
}

export async function main(): Promise<void> {
  const templates = await listPolicyTemplates();
  for (const template of templates) {
    console.log(`${template.type}: ${template.description}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
