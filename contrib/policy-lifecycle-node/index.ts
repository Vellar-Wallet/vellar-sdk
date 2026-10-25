// Framework-free Node / vanilla TypeScript contrib example (#630):
// Walks through the full Vellar smart-account policy lifecycle —
//   1. `wallet.policies.listTemplates()`
//   2. `wallet.policies.generate(definition)`
//   3. `wallet.policies.simulate(policy.id)`
//   4. `wallet.policies.deploy(policy.id)` (deploy-instance -> passkey attach -> record)
// against a local mocked policy API gateway without any UI framework.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { WalletNotReadyError } from "../../src/client";
import { createPolicyFacade, type PolicyAttachRuntime } from "../../src/policy-facade";
import {
  enforcementLabel,
  stroopsToXlm,
  type DeployPolicyResult,
  type GeneratedPolicy,
  type PolicyTemplateInfo,
  type SimulateResult,
} from "../../src/policy-types";
import type { PolicyDefinition } from "../../src/types";

export const DEMO_WALLET_ADDRESS =
  "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
export const DEMO_POLICY_CONTRACT_ID =
  "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3";
export const DEMO_VERIFIED_REGISTRY_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const DEMO_ATTACH_TX_HASH =
  "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

export interface MockPolicyGatewayOptions {
  /** Override simulation result (e.g. `{ ok: false, error: "insufficient fee" }`). */
  simulateResponse?: SimulateResult;
  /** Simulate an HTTP error status on `POST /policies/deploy` (e.g. 503 or 422). */
  recordDeployErrorStatus?: number;
  /** Error message returned when `recordDeployErrorStatus` is set. */
  recordDeployErrorMessage?: string;
}

export interface MockPolicyGatewayServer {
  readonly apiUrl: string;
  readonly requests: Array<{ method: string; path: string; body: unknown }>;
  close(): Promise<void>;
}

const DEFAULT_TEMPLATES: PolicyTemplateInfo[] = [
  {
    type: "spending-limit",
    title: "Rolling Daily Spending Limit",
    description: "Caps cumulative outflows over a rolling 24-hour window on-chain.",
    enforcement: {
      kind: "policy-contract",
      wasmHash: "11".repeat(32),
      constructorArgs: {
        dailyLimitStroops: "1000000000", // 100 XLM
        windowSeconds: 86_400,
      },
    },
  },
  {
    type: "verified-recipient",
    title: "Verified Recipient Allowlist",
    description: "Restricts transfers to contracts attested in the verification registry.",
    enforcement: {
      kind: "policy-contract",
      wasmHash: "22".repeat(32),
      constructorArgs: {
        registry: DEMO_VERIFIED_REGISTRY_ID,
      },
    },
  },
];

/**
 * Start a local HTTP mock of the Vellar Policy API Gateway handling:
 * - `GET  /policies/templates`
 * - `POST /policies/generate`
 * - `POST /policies/:id/simulate`
 * - `POST /policies/:id/deploy-instance`
 * - `POST /policies/deploy`
 */
export async function startMockPolicyGateway(
  options: MockPolicyGatewayOptions = {},
): Promise<MockPolicyGatewayServer> {
  const policies = new Map<string, GeneratedPolicy>();
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let rawBody = "";
    for await (const chunk of req) {
      rawBody += chunk;
    }
    const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
    const method = req.method ?? "GET";
    const path = req.url ?? "/";
    requests.push({ method, path, body: parsedBody });

    const sendJson = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (method === "GET" && path === "/policies/templates") {
      sendJson(200, DEFAULT_TEMPLATES);
      return;
    }

    if (method === "POST" && path === "/policies/generate") {
      const body = parsedBody as {
        definition?: PolicyDefinition;
        network?: "testnet" | "mainnet";
      };
      const def = body?.definition;
      if (!def || !def.type || !Array.isArray(def.owners) || def.owners.length === 0) {
        sendJson(400, {
          error: "invalid_policy_definition",
          errors: ["definition.type and at least one owner are required"],
        });
        return;
      }

      const tpl =
        DEFAULT_TEMPLATES.find((t) => t.type === def.type) ?? DEFAULT_TEMPLATES[0]!;
      const policy: GeneratedPolicy = {
        id: "pol_spending_limit_01",
        createdAt: "2026-10-18T00:00:00.000Z",
        status: "generated",
        definition: def,
        policyHash: "ab".repeat(32),
        manifest: {
          template: tpl.type,
          enforcement: tpl.enforcement,
          network: body.network ?? "testnet",
        },
      };
      policies.set(policy.id, policy);
      sendJson(200, { policy });
      return;
    }

    const simulateMatch = /^\/policies\/([^/]+)\/simulate$/.exec(path);
    if (method === "POST" && simulateMatch) {
      const policyId = simulateMatch[1]!;
      if (!policies.has(policyId)) {
        sendJson(404, { error: `Policy ${policyId} not found` });
        return;
      }
      const simResult: SimulateResult = options.simulateResponse ?? {
        ok: true,
        minResourceFee: "74500",
      };
      sendJson(200, simResult);
      return;
    }

    const deployInstanceMatch = /^\/policies\/([^/]+)\/deploy-instance$/.exec(path);
    if (method === "POST" && deployInstanceMatch) {
      const policyId = deployInstanceMatch[1]!;
      const existing = policies.get(policyId);
      if (!existing) {
        sendJson(404, { error: `Policy ${policyId} not found` });
        return;
      }
      const updated: GeneratedPolicy = {
        ...existing,
        status: "instance_deployed",
        instance: {
          contractId: DEMO_POLICY_CONTRACT_ID,
          txHash: "cd".repeat(32),
          deployedAt: "2026-10-18T00:00:01.000Z",
        },
      };
      policies.set(policyId, updated);
      sendJson(200, { contractId: DEMO_POLICY_CONTRACT_ID });
      return;
    }

    if (method === "POST" && path === "/policies/deploy") {
      if (options.recordDeployErrorStatus) {
        sendJson(options.recordDeployErrorStatus, {
          error:
            options.recordDeployErrorMessage ??
            `deploy recording failed (${options.recordDeployErrorStatus})`,
        });
        return;
      }

      const body = parsedBody as {
        policyId: string;
        txHash: string;
        contractId?: string;
      };
      const existing = policies.get(body.policyId);
      if (!existing) {
        sendJson(404, { error: `Policy ${body.policyId} not found` });
        return;
      }
      const deployed: GeneratedPolicy = {
        ...existing,
        status: "deployed",
        deployment: {
          contractId: body.contractId ?? DEMO_POLICY_CONTRACT_ID,
          txHash: body.txHash,
          deployedAt: "2026-10-18T00:00:02.000Z",
        },
      };
      policies.set(body.policyId, deployed);
      sendJson(200, { policy: deployed });
      return;
    }

    sendJson(404, { error: `Unhandled route: ${method} ${path}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const apiUrl = `http://127.0.0.1:${addr.port}`;

  return {
    apiUrl,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface RunPolicyLifecycleOptions {
  /** Optional gateway overrides for testing failure modes. */
  gatewayOptions?: MockPolicyGatewayOptions;
  /** Whether to omit `policyAttach` on `createVellarWallet` (tests `PolicyNotDeployableError`). */
  omitAttachRuntime?: boolean;
  /** Whether to skip `wallet.connect()` before calling `simulate`/`deploy` (tests `WalletNotReadyError`). */
  skipConnect?: boolean;
  /** Custom policy definition override. */
  definition?: PolicyDefinition;
  /** Custom logger (defaults to `console.log`). */
  log?: (line: string) => void;
}

export interface PolicyLifecycleRunResult {
  readonly templates: PolicyTemplateInfo[];
  readonly generated: GeneratedPolicy;
  readonly simulation: SimulateResult;
  readonly deployed: DeployPolicyResult;
  readonly attachCalls: Array<{ step: "resume" | "attachPolicy"; arg: string }>;
  readonly gatewayRequests: Array<{ method: string; path: string; body: unknown }>;
  readonly logs: string[];
}

/**
 * Execute the full headless policy lifecycle (`listTemplates` -> `generate` ->
 * `simulate` -> `deploy`) using `createVellarWallet` against the mock policy
 * gateway.
 */
export async function runPolicyLifecycleExample(
  options: RunPolicyLifecycleOptions = {},
): Promise<PolicyLifecycleRunResult> {
  const logs: string[] = [];
  const emit = (line: string) => {
    logs.push(line);
    (options.log ?? console.log)(line);
  };

  const gateway = await startMockPolicyGateway(options.gatewayOptions);
  const attachCalls: Array<{ step: "resume" | "attachPolicy"; arg: string }> = [];

  const attachRuntime: PolicyAttachRuntime = {
    async resume(keyId: string) {
      attachCalls.push({ step: "resume", arg: keyId });
      emit(`[Step 4b] Resumed passkey credential keyId=${keyId}`);
    },
    async attachPolicy(policyContractId: string) {
      attachCalls.push({ step: "attachPolicy", arg: policyContractId });
      emit(
        `[Step 4b] Passkey-signed kit.addPolicy(${policyContractId}) -> txHash=${DEMO_ATTACH_TX_HASH}`,
      );
      return { hash: DEMO_ATTACH_TX_HASH };
    },
  };

  try {
    const activeSession = options.skipConnect
      ? null
      : {
          accountId: DEMO_WALLET_ADDRESS,
          keyId: "passkey-cred-01",
          network: "testnet" as const,
        };

    const policies = createPolicyFacade({
      apiUrl: gateway.apiUrl,
      network: "testnet",
      requireSession: () => {
        if (!activeSession) {
          throw new WalletNotReadyError("Call create() or connect() before using policies");
        }
        return { accountId: activeSession.accountId, keyId: activeSession.keyId };
      },
      ...(options.omitAttachRuntime ? {} : { attach: attachRuntime }),
    });

    if (activeSession) {
      emit(`[Init] Active wallet session ${activeSession.accountId} on ${activeSession.network}`);
    }

    // Step 1: List available policy templates from the gateway.
    const templates = await policies.listTemplates();
    const chosenTemplate = templates[0]!;
    const dailyCapXlm =
      chosenTemplate.enforcement.kind === "policy-contract" &&
      chosenTemplate.enforcement.constructorArgs &&
      "dailyLimitStroops" in chosenTemplate.enforcement.constructorArgs
        ? stroopsToXlm(chosenTemplate.enforcement.constructorArgs.dailyLimitStroops)
        : "N/A";
    emit(
      `[Step 1: listTemplates] Found ${templates.length} templates. Selected "${chosenTemplate.type}" (default cap: ${dailyCapXlm} XLM) — ${enforcementLabel(chosenTemplate.enforcement)}`,
    );

    // Step 2: Generate a policy artifact from a PolicyDefinition.
    const definition: PolicyDefinition = options.definition ?? {
      version: "1.0",
      type: chosenTemplate.type,
      owners: [DEMO_WALLET_ADDRESS],
      threshold: 1,
      spendingLimits: {
        dailyXlm: "100",
        perTxXlm: "25",
      },
    };
    const generated = await policies.generate(definition);
    emit(
      `[Step 2: generate] Generated policy id=${generated.id} status=${generated.status} policyHash=${generated.policyHash}`,
    );

    // Step 3: Simulate on-chain policy deployment for the connected wallet.
    const simulation = await policies.simulate(generated.id);
    emit(
      `[Step 3: simulate] Simulation ok=${simulation.ok} minResourceFee=${simulation.minResourceFee ?? "0"} error=${simulation.error ?? "none"}`,
    );
    if (!simulation.ok) {
      throw new Error(
        `Policy simulation failed for ${generated.id}: ${simulation.error ?? "unknown simulation error"}`,
      );
    }

    // Step 4: Deploy the policy instance, passkey-sign the attach, and record deployment.
    const deployed = await policies.deploy(generated.id);
    emit(
      `[Step 4: deploy] Deployed policy id=${deployed.policy.id} status=${deployed.policy.status} contractId=${deployed.contractId} attachTxHash=${deployed.attachTxHash}`,
    );

    return {
      templates,
      generated,
      simulation,
      deployed,
      attachCalls,
      gatewayRequests: [...gateway.requests],
      logs,
    };
  } finally {
    await gateway.close();
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runPolicyLifecycleExample().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
