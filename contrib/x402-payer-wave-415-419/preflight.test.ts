import { describe, expect, it } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { runPreflight, extractPoliciesFromSignerVal } from "./preflight";

const VALID_SECRET = "SDJ34VDR4Z3G3Y5QG2F37YJ7H76K4EOG3JTXK3P2D6U4XZ2D6U4XZ2D6";
const WALLET_ADDR = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const POLICY_ADDR = "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ";

describe("runPreflight (#415)", () => {
  it("passes when the whole configuration, RPC, signer, and policies are valid", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "testnet",
        walletAddress: WALLET_ADDR,
        policies: [POLICY_ADDR],
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
        getContractInstance: async () => ({}),
      },
      kit: {
        getSigner: async () => ({
          limits: [POLICY_ADDR],
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.spendMode).toBe("chain-enforced (smart account policy)");
    expect(result.details.payerAddress).toBe(kp.publicKey());
    expect(result.details.walletAddress).toBe(WALLET_ADDR);
    expect(result.details.requiredPolicies).toEqual([POLICY_ADDR]);
  });

  it("reports process-only when no wallet is configured", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "testnet",
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.spendMode).toBe("process-only (hot wallet)");
    expect(result.details.payerAddress).toBe(kp.publicKey());
  });

  it("fails when secret seed is invalid", async () => {
    const result = await runPreflight({
      config: {
        secret: "not-a-seed",
        network: "testnet",
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("not a valid Ed25519 secret seed"))).toBe(true);
  });

  it("fails loudly when RPC network does not match configured network", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "mainnet",
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }), // testnet RPC on mainnet
      },
    });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("RPC network mismatch"))).toBe(true);
  });

  it("fails when derived key is not registered as a signer on the wallet", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "testnet",
        walletAddress: WALLET_ADDR,
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
        getContractInstance: async () => ({}),
      },
      kit: {
        getSigner: async () => null, // not registered
      },
    });

    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("not registered as a signer"))).toBe(true);
  });

  it("fails when on-chain limits require a policy missing from VELLAR_X402_POLICIES", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "testnet",
        walletAddress: WALLET_ADDR,
        policies: [], // missing POLICY_ADDR
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
        getContractInstance: async () => ({}),
      },
      kit: {
        getSigner: async () => ({
          limits: [POLICY_ADDR],
        }),
      },
    });

    expect(result.ok).toBe(false);
    expect(
      result.problems.some((p) =>
        p.includes(`On-chain signer limits require policy contract ${POLICY_ADDR}`),
      ),
    ).toBe(true);
  });

  it("fails when a configured policy contract does not exist on-chain", async () => {
    const kp = Keypair.random();
    const result = await runPreflight({
      config: {
        secret: kp.secret(),
        network: "testnet",
        walletAddress: WALLET_ADDR,
        policies: [POLICY_ADDR],
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
        getContractInstance: async (id) => {
          if (id === POLICY_ADDR) throw new Error("not found");
          return {};
        },
      },
      kit: {
        getSigner: async () => ({ limits: [] }),
      },
    });

    expect(result.ok).toBe(false);
    expect(
      result.problems.some((p) =>
        p.includes(`Configured policy contract ${POLICY_ADDR} does not exist on-chain`),
      ),
    ).toBe(true);
  });

  it("reports all failures rather than aborting at the first failure", async () => {
    const result = await runPreflight({
      config: {
        secret: "invalid",
        network: "mainnet",
      },
      rpcServer: {
        getNetwork: async () => ({ passphrase: Networks.TESTNET }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
    expect(result.problems.some((p) => p.includes("not a valid Ed25519 secret seed"))).toBe(true);
    expect(result.problems.some((p) => p.includes("RPC network mismatch"))).toBe(true);
  });
});
