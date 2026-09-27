// Preflight self-check command tests (#415).

import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  extractPoliciesFromSignerVal,
  runPreflight,
  type KitLike,
  type RpcServerLike,
} from "../src/preflight.js";
import { ASSET_A, freshSecret, testEnv } from "./helpers.js";

const VALID_WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const POLICY_A = "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3";
const POLICY_B = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("preflight self-check (#415)", () => {
  it("passes cleanly for a hot wallet when RPC matches", async () => {
    const secret = freshSecret();
    const kp = Keypair.fromSecret(secret);
    const config = loadConfig(
      testEnv({
        secret,
        network: "testnet",
      }),
    );

    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET, protocolVersion: 22 };
      },
    };

    const result = await runPreflight({ config, rpcServer: mockRpc });

    expect(result.ok).toBe(true);
    expect(result.spendMode).toBe("process-only (hot wallet)");
    expect(result.problems).toHaveLength(0);
    expect(result.details.payerAddress).toBe(kp.publicKey());
    expect(result.details.network).toBe("testnet");
  });

  it("passes cleanly for a smart account when signer and policies are valid", async () => {
    const secret = freshSecret();
    const kp = Keypair.fromSecret(secret);
    const config = loadConfig(
      testEnv({
        secret,
        network: "testnet",
        VELLAR_X402_WALLET: VALID_WALLET,
        VELLAR_X402_POLICIES: POLICY_A,
      }),
    );

    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET };
      },
      async getContractInstance(id: string) {
        return { id };
      },
    };

    const mockKit: KitLike = {
      async getSigner() {
        return {
          tag: "Ed25519",
          limits: [POLICY_A],
        };
      },
    };

    const result = await runPreflight({
      config,
      rpcServer: mockRpc,
      kit: mockKit,
    });

    expect(result.ok).toBe(true);
    expect(result.spendMode).toBe("chain-enforced (smart account policy)");
    expect(result.problems).toHaveLength(0);
    expect(result.details.walletAddress).toBe(VALID_WALLET);
  });

  it("fails loudly when RPC network does not match configured network", async () => {
    const config = loadConfig(
      testEnv({
        network: "mainnet",
      }),
    );

    // Mock RPC returning testnet passphrase when config is mainnet
    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET };
      },
    };

    const result = await runPreflight({ config, rpcServer: mockRpc });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("RPC network mismatch"))).toBe(true);
  });

  it("fails loudly when RPC connection throws", async () => {
    const config = loadConfig(testEnv());
    const mockRpc: RpcServerLike = {
      async getNetwork() {
        throw new Error("Connection refused ECONNREFUSED");
      },
    };

    const result = await runPreflight({ config, rpcServer: mockRpc });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("RPC failure"))).toBe(true);
  });

  it("fails when the wallet signer is not registered", async () => {
    const secret = freshSecret();
    const config = loadConfig(
      testEnv({
        secret,
        VELLAR_X402_WALLET: VALID_WALLET,
      }),
    );

    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET };
      },
      async getContractInstance() {
        return {};
      },
    };

    const mockKit: KitLike = {
      async getSigner() {
        return null; // Not registered
      },
    };

    const result = await runPreflight({
      config,
      rpcServer: mockRpc,
      kit: mockKit,
    });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("not registered as a signer"))).toBe(true);
  });

  it("fails when on-chain SignerLimits require a policy missing from VELLAR_X402_POLICIES", async () => {
    const secret = freshSecret();
    const config = loadConfig(
      testEnv({
        secret,
        VELLAR_X402_WALLET: VALID_WALLET,
        VELLAR_X402_POLICIES: POLICY_A,
      }),
    );

    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET };
      },
      async getContractInstance() {
        return {};
      },
    };

    const mockKit: KitLike = {
      async getSigner() {
        // Signer requires both POLICY_A and POLICY_B
        return {
          tag: "Ed25519",
          requiredPolicies: [POLICY_A, POLICY_B],
        };
      },
    };

    const result = await runPreflight({
      config,
      rpcServer: mockRpc,
      kit: mockKit,
    });

    expect(result.ok).toBe(false);
    expect(
      result.problems.some(
        (p) => p.includes("missing from VELLAR_X402_POLICIES") && p.includes(POLICY_B),
      ),
    ).toBe(true);
  });

  it("fails when configured policy contract does not exist on-chain", async () => {
    const secret = freshSecret();
    const config = loadConfig(
      testEnv({
        secret,
        VELLAR_X402_WALLET: VALID_WALLET,
        VELLAR_X402_POLICIES: POLICY_A,
      }),
    );

    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET };
      },
      async getContractInstance(id: string) {
        if (id === POLICY_A) {
          throw new Error("404 Not Found");
        }
        return {};
      },
    };

    const mockKit: KitLike = {
      async getSigner() {
        return { tag: "Ed25519", requiredPolicies: [POLICY_A] };
      },
    };

    const result = await runPreflight({
      config,
      rpcServer: mockRpc,
      kit: mockKit,
    });

    expect(result.ok).toBe(false);
    expect(
      result.problems.some(
        (p) => p.includes("does not exist on-chain") && p.includes(POLICY_A),
      ),
    ).toBe(true);
  });

  it("collects multiple problems across categories", async () => {
    const secret = freshSecret();
    const config = loadConfig(
      testEnv({
        secret,
        network: "mainnet",
        VELLAR_X402_WALLET: VALID_WALLET,
        VELLAR_X402_POLICIES: POLICY_A,
      }),
    );

    // Mismatched RPC AND missing wallet signer AND policy 404
    const mockRpc: RpcServerLike = {
      async getNetwork() {
        return { passphrase: Networks.TESTNET }; // mismatch
      },
      async getContractInstance() {
        throw new Error("404 Not Found");
      },
    };

    const mockKit: KitLike = {
      async getSigner() {
        return null; // missing signer
      },
    };

    const result = await runPreflight({
      config,
      rpcServer: mockRpc,
      kit: mockKit,
    });

    expect(result.ok).toBe(false);
    // Must collect multiple problems, not just abort at the first
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
    expect(result.problems.some((p) => p.includes("RPC network mismatch"))).toBe(true);
    expect(result.problems.some((p) => p.includes("not registered as a signer"))).toBe(true);
  });
});
