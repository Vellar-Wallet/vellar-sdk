import { createMockPolicyApi } from "./index";

console.log("full-policy-flow tests:");

{
  const api = createMockPolicyApi();

  // 1) list templates
  const templates = await api.listTemplates();
  console.assert(templates.length >= 1, "expected templates");
  console.log("ok: listTemplates →", templates.length, "templates");

  // 2) generate policy
  const definition: Parameters<typeof api.generate>[0] = { version: "1", type: "spending-limit", owners: ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] };
  const generated = await api.generate(definition);
  console.assert(generated.status === "generated", "expected generated");
  console.log("ok: generate →", generated.id);

  // 3) simulate accepted
  const accepted = await api.simulate(generated.id, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  console.assert(accepted.ok === true, "expected accepted simulation");
  console.log("ok: simulate accepted → ok=true");

  // 4) simulate rejected
  const rejected = await api.simulate(generated.id, "GZZZxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  console.assert(rejected.ok === false, "expected rejected simulation");
  console.log("ok: simulate rejected → ok=false, error=", rejected.error);

  // 5) deploy instance + record
  const { contractId } = await api.deployInstance(generated.id, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const recorded = await api.recordDeployment(generated.id, "tx-hash-123", contractId);
  console.assert(recorded.status === "deployed", "expected deployed status");
  console.assert(recorded.instance !== undefined, "expected instance");
  console.log("ok: deployInstance + recordDeployment → status=deployed");
}

console.log("full-policy-flow tests passed");