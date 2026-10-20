import type { PolicyDefinition } from "../../../src/types";
import type { GeneratedPolicy, PolicyTemplateInfo } from "../../../src/policy-types";

const WALLET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const CONTRACT = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

export interface MockPolicyGateway {
  fetch: typeof fetch;
  requests: Array<{ method: string; path: string; body?: unknown }>;
}

export function createMockPolicyGateway(): MockPolicyGateway {
  const requests: MockPolicyGateway["requests"] = [];
  const policies = new Map<string, GeneratedPolicy>();
  let nextId = 1;

  const templates: PolicyTemplateInfo[] = [
    {
      type: "spending-limit",
      title: "Daily spending limit",
      description: "Limit outbound spend during a rolling window.",
      enforcement: {
        kind: "policy-contract",
        wasmHash: "a".repeat(64),
        constructorArgs: { dailyLimitStroops: "250000000", windowSeconds: 86400 },
      },
    },
  ];

  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, ...(body === undefined ? {} : { body }) });

    if (method === "GET" && url.pathname === "/policies/templates") {
      return Response.json(templates);
    }

    if (method === "POST" && url.pathname === "/policies/generate") {
      const definition = (body as { definition: PolicyDefinition }).definition;
      const id = `policy-${nextId++}`;
      const policy: GeneratedPolicy = {
        id,
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "generated",
        definition,
        policyHash: "b".repeat(64),
        manifest: {
          template: definition.type,
          enforcement: templates[0]!.enforcement,
          network: "testnet",
        },
      };
      policies.set(id, policy);
      return Response.json({ policy });
    }

    const simulate = /^\/policies\/([^/]+)\/simulate$/.exec(url.pathname);
    if (method === "POST" && simulate) {
      if (!policies.has(simulate[1]!)) return Response.json({ message: "not found" }, { status: 404 });
      return Response.json({ ok: true, minResourceFee: "100000" });
    }

    const deployInstance = /^\/policies\/([^/]+)\/deploy-instance$/.exec(url.pathname);
    if (method === "POST" && deployInstance) {
      if (!policies.has(deployInstance[1]!)) {
        return Response.json({ message: "not found" }, { status: 404 });
      }
      if ((body as { wallet?: string }).wallet !== WALLET) {
        return Response.json({ message: "wrong wallet" }, { status: 400 });
      }
      return Response.json({ contractId: CONTRACT });
    }

    if (method === "POST" && url.pathname === "/policies/deploy") {
      const inputBody = body as { policyId: string; txHash: string; contractId: string };
      const existing = policies.get(inputBody.policyId);
      if (!existing) return Response.json({ message: "not found" }, { status: 404 });
      const deployed: GeneratedPolicy = {
        ...existing,
        status: "deployed",
        deployment: {
          contractId: inputBody.contractId,
          txHash: inputBody.txHash,
          deployedAt: "2026-01-01T00:01:00.000Z",
        },
      };
      policies.set(deployed.id, deployed);
      return Response.json({ policy: deployed });
    }

    return Response.json({ message: `unhandled ${method} ${url.pathname}` }, { status: 404 });
  };

  return { fetch: mockFetch as typeof fetch, requests };
}

export const mockPolicyIds = { wallet: WALLET, contract: CONTRACT } as const;
