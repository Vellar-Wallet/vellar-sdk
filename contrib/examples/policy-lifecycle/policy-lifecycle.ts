import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPolicyFacade } from "../../../src/policy-facade";
import { createMockPolicyGateway, mockPolicyIds } from "./mock-policy-gateway";

export interface PolicyLifecycleResult {
  templateCount: number;
  policyId: string;
  simulationOk: boolean;
  contractId: string;
  attachTxHash: string;
  requestPaths: string[];
}

export async function runPolicyLifecycle(
  log: (message: string) => void = console.log,
): Promise<PolicyLifecycleResult> {
  const gateway = createMockPolicyGateway();
  const policies = createPolicyFacade({
    apiUrl: "https://mock-policy-gateway.test",
    network: "testnet",
    requireSession: () => ({ accountId: mockPolicyIds.wallet, keyId: "demo-passkey" }),
    fetch: gateway.fetch,
    attach: {
      async resume(keyId) {
        log(`resume: ${keyId}`);
      },
      async attachPolicy(contractId) {
        log(`attach: ${contractId}`);
        return { hash: "c".repeat(64) };
      },
    },
  });

  const templates = await policies.listTemplates();
  log(`listTemplates: ${templates.length} template(s)`);

  const generated = await policies.generate({
    version: "1",
    type: "spending-limit",
    owners: [mockPolicyIds.wallet],
    spendingLimits: { dailyXlm: "25" },
  });
  log(`generate: ${generated.id} (${generated.status})`);

  const simulation = await policies.simulate(generated.id);
  log(`simulate: ok=${simulation.ok} minResourceFee=${simulation.minResourceFee}`);

  const deployed = await policies.deploy(generated.id);
  log(`deploy: ${deployed.contractId} tx=${deployed.attachTxHash}`);

  return {
    templateCount: templates.length,
    policyId: generated.id,
    simulationOk: simulation.ok,
    contractId: deployed.contractId,
    attachTxHash: deployed.attachTxHash,
    requestPaths: gateway.requests.map(({ path }) => path),
  };
}

async function main() {
  const result = await runPolicyLifecycle();
  console.log(`complete: ${result.policyId} -> ${result.contractId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
