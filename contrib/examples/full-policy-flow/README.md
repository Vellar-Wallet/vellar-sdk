# full-policy-flow

Reference example demonstrating a full policy generate and simulate flow using a mocked policy API.

## Flow

1. List available templates.
2. Generate a policy from a definition.
3. Simulate the policy for a wallet (both accepted and rejected outcomes).
4. Deploy an instance and record the deployment.

All API calls are mocked within the example.

## Usage

```ts
import { createMockPolicyApi } from "./index";

const api = createMockPolicyApi();

const templates = await api.listTemplates();
const generated = await api.generate({ version: "1", type: "spending-limit", owners: ["G..."] });
const simulate = await api.simulate(generated.id, "G...");

if (simulate.ok) {
  const { contractId } = await api.deployInstance(generated.id, "G...");
  const recorded = await api.recordDeployment(generated.id, "tx-hash", contractId);
  console.log(recorded.status);
}