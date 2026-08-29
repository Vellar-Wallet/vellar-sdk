import { describe, expect, it } from "vitest";
import { createPolicyClient } from "../../../src/policy-client";
import { mockPolicyGatewayFetch } from "./mock-policy-gateway";

describe("mockPolicyGatewayFetch wired into createPolicyClient", () => {
  const client = createPolicyClient({
    apiUrl: "https://mock-gateway.example.com",
    network: "testnet",
    fetch: mockPolicyGatewayFetch,
  });

  it("listTemplates returns at least one template", async () => {
    const templates = await client.listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]).toHaveProperty("type");
    expect(templates[0]).toHaveProperty("enforcement");
  });

  it("generate returns a GeneratedPolicy", async () => {
    const policy = await client.generate({ version: "1", type: "spending-limit", owners: ["GOWNER"] });
    expect(policy.id).toBeTruthy();
    expect(policy.status).toBe("generated");
  });

  it("simulate returns a SimulateResult", async () => {
    const result = await client.simulate("policy_mock123", "CWALLET");
    expect(result.ok).toBe(true);
  });

  it("404s an unmocked route", async () => {
    const res = await mockPolicyGatewayFetch("https://mock-gateway.example.com/policies/unknown-route");
    expect(res.status).toBe(404);
  });
});
