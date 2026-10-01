import { describe, expect, it, vi } from "vitest";
import { resumableDeploy, resumeDeploy, DeployPolicyError } from "./resumable-deploy";
import { PolicyApiError } from "../../src/policy-types";
import type { PolicyClient } from "../../src/policy-client";
import type { PolicyAttachRuntime } from "../../src/policy-facade";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const WALLET = "CWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDE";

function mockClient(overrides?: {
  deployInstance?: () => Promise<{ contractId: string }>;
  recordDeployment?: () => Promise<unknown>;
}): PolicyClient {
  return {
    listTemplates: vi.fn(),
    listPolicies: vi.fn(),
    validate: vi.fn(),
    generate: vi.fn(),
    simulate: vi.fn(),
    deployInstance:
      overrides?.deployInstance ??
      vi.fn(async () => ({ contractId: "CINSTANCE" })),
    recordDeployment:
      overrides?.recordDeployment ??
      vi.fn(async () => ({ id: "p1", status: "deployed" }) as any),
  };
}

function mockAttach(overrides?: {
  attachPolicy?: () => Promise<{ hash: string }>;
}): PolicyAttachRuntime {
  return {
    resume: vi.fn(async () => {}),
    attachPolicy:
      overrides?.attachPolicy ?? vi.fn(async () => ({ hash: "ATTACHTX" })),
  };
}

describe("resumableDeploy (#447)", () => {
  it("runs deploy-instance → attach → record, in order", async () => {
    const calls: string[] = [];
    const client = mockClient({
      deployInstance: vi.fn(async () => {
        calls.push("deploy-instance");
        return { contractId: "CINSTANCE" };
      }),
      recordDeployment: vi.fn(async () => {
        calls.push("record");
        return { id: "p1", status: "deployed" } as any;
      }),
    });
    const attach = mockAttach({
      attachPolicy: vi.fn(async () => {
        calls.push("attach");
        return { hash: "ATTACHTX" };
      }),
    });

    const result = await resumableDeploy(
      { client, attach, requireSession: () => ({ accountId: WALLET, keyId: "key-1" }) },
      "p1",
    );

    expect(result).toEqual({
      policy: { id: "p1", status: "deployed" },
      contractId: "CINSTANCE",
      attachTxHash: "ATTACHTX",
    });
    expect(calls).toEqual(["deploy-instance", "attach", "record"]);
  });

  it("resumeDeploy completes only the record step", async () => {
    const client = mockClient();
    const result = await resumeDeploy(client, "p1", "ATTACHTX", "CINSTANCE");

    expect(result).toEqual({
      policy: { id: "p1", status: "deployed" },
      contractId: "CINSTANCE",
      attachTxHash: "ATTACHTX",
    });
    expect(client.recordDeployment).toHaveBeenCalledOnce();
    expect(client.deployInstance).not.toHaveBeenCalled();
  });

  it("resumeDeploy does NOT issue a passkey prompt", async () => {
    const client = mockClient();
    const attach = mockAttach();
    await resumeDeploy(client, "p1", "ATTACHTX");

    expect(attach.resume).not.toHaveBeenCalled();
    expect(attach.attachPolicy).not.toHaveBeenCalled();
  });

  it("throws DeployPolicyError with contractId when attach fails", async () => {
    const client = mockClient();
    const attach = mockAttach({
      attachPolicy: vi.fn(async () => {
        throw new Error("passkey failed");
      }),
    });

    await expect(
      resumableDeploy(
        { client, attach, requireSession: () => ({ accountId: WALLET }) },
        "p1",
      ),
    ).rejects.toMatchObject({
      name: "DeployPolicyError",
      contractId: "CINSTANCE",
      attachHash: undefined,
    });
  });

  it("throws DeployPolicyError with contractId and attachHash when record fails", async () => {
    const client = mockClient({
      recordDeployment: vi.fn(async () => {
        throw new PolicyApiError("server down", 500);
      }),
    });
    const attach = mockAttach();

    await expect(
      resumableDeploy(
        { client, attach, requireSession: () => ({ accountId: WALLET }) },
        "p1",
      ),
    ).rejects.toMatchObject({
      name: "DeployPolicyError",
      contractId: "CINSTANCE",
      attachHash: "ATTACHTX",
    });
  });

  it("retries deploy-instance on 503 retryable error", async () => {
    let calls = 0;
    const client = mockClient({
      deployInstance: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new PolicyApiError("unavailable", 503);
        return { contractId: "CINSTANCE" };
      }),
    });
    const attach = mockAttach();

    const result = await resumableDeploy(
      { client, attach, requireSession: () => ({ accountId: WALLET }) },
      "p1",
    );
    expect(result.contractId).toBe("CINSTANCE");
    expect(calls).toBe(2);
  });

  it("does NOT retry on 422 terminal error", async () => {
    const client = mockClient({
      deployInstance: vi.fn(async () => {
        throw new PolicyApiError("attach_mismatch", 422);
      }),
    });
    const attach = mockAttach();

    await expect(
      resumableDeploy(
        { client, attach, requireSession: () => ({ accountId: WALLET }) },
        "p1",
      ),
    ).rejects.toBeInstanceOf(PolicyApiError);
    expect(client.deployInstance).toHaveBeenCalledOnce();
  });
});