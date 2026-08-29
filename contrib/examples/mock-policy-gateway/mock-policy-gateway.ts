// Example: a mock fetch handler returning canned responses for the policy
// API gateway's list-templates, generate, and simulate routes — for
// offline tests that need to wire the real createPolicyClient() to
// something other than a live gateway.
//
// Run with: npx tsx mock-policy-gateway.ts

import { createPolicyClient } from "../../../src/policy-client";
import type { GeneratedPolicy, PolicyTemplateInfo, SimulateResult } from "../../../src/policy-types";

const MOCK_TEMPLATES: PolicyTemplateInfo[] = [
  {
    type: "spending-limit",
    title: "Spending limit",
    description: "A rolling-window daily spending cap enforced by a dedicated policy contract.",
    enforcement: { kind: "policy-contract", wasmHash: "mock-wasm-hash" },
  },
  {
    type: "none",
    title: "No extra policy",
    description: "Default single-owner behaviour.",
    enforcement: { kind: "none" },
  },
];

const MOCK_GENERATED_POLICY: GeneratedPolicy = {
  id: "policy_mock123",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "generated",
  definition: { version: "1", type: "spending-limit", owners: ["GOWNER"] },
  policyHash: "mock-policy-hash",
  manifest: {
    template: "spending-limit",
    enforcement: { kind: "policy-contract", wasmHash: "mock-wasm-hash" },
    network: "testnet",
  },
};

const MOCK_SIMULATE_RESULT: SimulateResult = { ok: true, minResourceFee: "100000" };

/** A mock fetch implementation covering the policy gateway's
 * templates/generate/simulate routes. Any other route 404s. */
export const mockPolicyGatewayFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
  const { pathname } = new URL(url);
  const method = init?.method ?? "GET";

  if (pathname === "/policies/templates" && method === "GET") {
    return new Response(JSON.stringify(MOCK_TEMPLATES), { status: 200 });
  }
  if (pathname === "/policies/generate" && method === "POST") {
    return new Response(JSON.stringify({ policy: MOCK_GENERATED_POLICY }), { status: 200 });
  }
  if (pathname.endsWith("/simulate") && method === "POST") {
    return new Response(JSON.stringify(MOCK_SIMULATE_RESULT), { status: 200 });
  }

  return new Response(JSON.stringify({ error: `mock gateway: no route for ${method} ${pathname}` }), {
    status: 404,
  });
}) as typeof fetch;

async function main() {
  const client = createPolicyClient({
    apiUrl: "https://mock-gateway.example.com",
    network: "testnet",
    fetch: mockPolicyGatewayFetch,
  });

  console.log("listTemplates():", await client.listTemplates());
  console.log();
  console.log(
    "generate():",
    await client.generate({ version: "1", type: "spending-limit", owners: ["GOWNER"] }),
  );
  console.log();
  console.log("simulate():", await client.simulate("policy_mock123", "CWALLET"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
