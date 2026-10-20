import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createAgentsFacade,
  type AgentKeyRuntime,
  type AgentPolicyGrant,
} from "../../../src/agents-facade";

const AGENT_PUBLIC_KEY = "G".padEnd(56, "A");
const TOKEN = "C".padEnd(56, "B");
const SPENDING_LIMIT = "C".padEnd(56, "C");
const VERIFIED_ONLY = "C".padEnd(56, "D");

export class MockAgentKeyRuntime implements AgentKeyRuntime {
  readonly activeKeys = new Map<string, AgentPolicyGrant[]>();

  async resume(_keyId: string): Promise<void> {}

  async addAgentKey(input: {
    publicKey: string;
    grants: AgentPolicyGrant[];
    expirationSeconds?: number;
    store: "persistent" | "temporary";
  }): Promise<{ hash: string }> {
    this.activeKeys.set(input.publicKey, structuredClone(input.grants));
    return { hash: "a".repeat(64) };
  }

  async removeAgentKey(publicKey: string): Promise<{ hash: string }> {
    this.activeKeys.delete(publicKey);
    return { hash: "b".repeat(64) };
  }

  async sign(publicKey: string, payload: string): Promise<string> {
    if (!this.activeKeys.has(publicKey)) {
      throw new Error(`agent key ${publicKey} is revoked or was never minted`);
    }
    return `signed:${Buffer.from(payload).toString("base64url")}`;
  }
}

export interface AgentKeyLifecycleResult {
  mintHash: string;
  revokeHash: string;
  signatureBeforeRevoke: string;
  signingRejectedAfterRevoke: boolean;
  grants: AgentPolicyGrant[];
}

export async function runAgentKeyLifecycle(
  log: (message: string) => void = console.log,
): Promise<AgentKeyLifecycleResult> {
  const runtime = new MockAgentKeyRuntime();
  const wallet = {
    agents: createAgentsFacade({
      requireSession: () => ({ accountId: "C".padEnd(56, "W"), keyId: "demo-passkey" }),
      runtime,
    }),
  };
  const grants = [{ token: TOKEN, policies: [SPENDING_LIMIT, VERIFIED_ONLY] }];

  const minted = await wallet.agents.mint({
    publicKey: AGENT_PUBLIC_KEY,
    grants,
    store: "persistent",
  });
  log(`mint: ${minted.publicKey} tx=${minted.hash}`);
  log(`grant: token=${TOKEN} spending-limit=${SPENDING_LIMIT} verified-only=${VERIFIED_ONLY}`);

  const signatureBeforeRevoke = await runtime.sign(AGENT_PUBLIC_KEY, "pay demo invoice");
  log(`sign before revoke: ${signatureBeforeRevoke}`);

  const revoked = await wallet.agents.revoke(AGENT_PUBLIC_KEY);
  log(`revoke: ${AGENT_PUBLIC_KEY} tx=${revoked.hash}`);

  let signingRejectedAfterRevoke = false;
  try {
    await runtime.sign(AGENT_PUBLIC_KEY, "pay after revoke");
  } catch {
    signingRejectedAfterRevoke = true;
    log("sign after revoke: rejected");
  }
  if (!signingRejectedAfterRevoke) throw new Error("revoked agent key remained active");

  return {
    mintHash: minted.hash,
    revokeHash: revoked.hash,
    signatureBeforeRevoke,
    signingRejectedAfterRevoke,
    grants,
  };
}

async function main() {
  await runAgentKeyLifecycle();
  console.log("complete: agent key cannot sign after revoke");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
