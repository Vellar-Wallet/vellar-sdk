import { describe, expect, it, vi } from "vitest";
import { BatchOperationError, createPerWalletQueue } from "./policy-batch-ordering";

describe("createPerWalletQueue.enqueue", () => {
  it("completes concurrent operations for the SAME account strictly in call order, even when each resolves unpredictably", async () => {
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const queue = createPerWalletQueue<string, string>();

    async function op(id: string): Promise<string> {
      await new Promise<void>((resolve) => gates.set(id, resolve));
      order.push(id);
      return `result-${id}`;
    }

    const pa = queue.enqueue("WALLET-A", "a", op);
    const pb = queue.enqueue("WALLET-A", "b", op);
    const pc = queue.enqueue("WALLET-A", "c", op);

    // "b" and "c" haven't even started their gate yet — the queue itself
    // serializes op() calls, not just their completion — so only "a"'s gate
    // exists at this point.
    await vi.waitFor(() => expect(gates.has("a")).toBe(true));
    gates.get("a")!();

    await vi.waitFor(() => expect(gates.has("b")).toBe(true));
    gates.get("b")!();

    await vi.waitFor(() => expect(gates.has("c")).toBe(true));
    gates.get("c")!();

    await Promise.all([pa, pb, pc]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("does not serialize operations for DIFFERENT accounts against each other", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const queue = createPerWalletQueue<string, string>();

    const pa = queue.enqueue("WALLET-A", "a", async (id) => {
      await gateA;
      order.push(id);
      return id;
    });
    const pb = queue.enqueue("WALLET-B", "b", async (id) => {
      order.push(id);
      return id;
    });

    await pb; // B completes even though A is still blocked
    expect(order).toEqual(["b"]);

    releaseA();
    await pa;
    expect(order).toEqual(["b", "a"]);
  });

  it("a failed operation does not block later operations for the same account", async () => {
    const queue = createPerWalletQueue<string, string>();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValueOnce("ok-2");

    const first = queue.enqueue("WALLET-A", "a", run);
    const second = queue.enqueue("WALLET-A", "b", run);

    await expect(first).rejects.toThrow("first fails");
    await expect(second).resolves.toBe("ok-2");
  });

  it("fires onOutOfOrder only in the (expected-never) out-of-order case, not during normal operation", async () => {
    const onOutOfOrder = vi.fn();
    const queue = createPerWalletQueue<string, string>({ onOutOfOrder });
    const run = vi.fn().mockResolvedValue("ok");

    await queue.enqueue("WALLET-A", "a", run);
    await queue.enqueue("WALLET-A", "b", run);
    await queue.enqueue("WALLET-A", "c", run);

    expect(onOutOfOrder).not.toHaveBeenCalled();
  });
});

describe("createPerWalletQueue.runBatch", () => {
  it("runs items strictly in the given order", async () => {
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const queue = createPerWalletQueue<string, string>();

    async function op(id: string): Promise<string> {
      await new Promise<void>((resolve) => gates.set(id, resolve));
      order.push(id);
      return `result-${id}`;
    }

    const batch = queue.runBatch("WALLET-A", ["x", "y", "z"], op);

    await vi.waitFor(() => expect(gates.has("x")).toBe(true));
    gates.get("x")!();
    await vi.waitFor(() => expect(gates.has("y")).toBe(true));
    gates.get("y")!();
    await vi.waitFor(() => expect(gates.has("z")).toBe(true));
    gates.get("z")!();

    const results = await batch;
    expect(results).toEqual(["result-x", "result-y", "result-z"]);
    expect(order).toEqual(["x", "y", "z"]);
  });

  it("stops after a failure, reporting what succeeded via BatchOperationError", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("ok-1")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok-3");
    const queue = createPerWalletQueue<string, string>();

    const err = await queue.runBatch("WALLET-A", ["p1", "p2", "p3"], run).catch((e) => e);

    expect(err).toBeInstanceOf(BatchOperationError);
    expect((err as BatchOperationError<string>).failedIndex).toBe(1);
    expect((err as BatchOperationError<string>).succeeded).toEqual(["ok-1"]);
    // p3 must never have been attempted.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a batch for one wallet does not block a concurrent batch for a different wallet", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const queue = createPerWalletQueue<string, string>();

    const batchA = queue.runBatch("WALLET-A", ["a1"], async (id) => {
      await gateA;
      order.push(id);
      return id;
    });
    const batchB = queue.runBatch("WALLET-B", ["b1", "b2"], async (id) => {
      order.push(id);
      return id;
    });

    await batchB;
    expect(order).toEqual(["b1", "b2"]);

    releaseA();
    await batchA;
    expect(order).toEqual(["b1", "b2", "a1"]);
  });
});

describe("applied to a PolicyFacade.deploy-shaped operation", () => {
  /** A minimal stand-in matching src/policy-facade.ts's DeployPolicyResult shape. */
  interface DeployResult {
    policy: { id: string };
    contractId: string;
    attachTxHash: string;
  }

  it("guarantees deploy() calls for the same connected wallet complete in call order", async () => {
    const attachOrder: string[] = [];
    const queue = createPerWalletQueue<string, DeployResult>();

    // Simulates PolicyFacade.deploy's three steps for one policyId.
    async function deployOne(policyId: string): Promise<DeployResult> {
      const contractId = `C-${policyId}`;
      // ...server-side instance deploy would happen here...
      attachOrder.push(contractId); // the passkey attach step
      return { policy: { id: policyId }, contractId, attachTxHash: `TX-${contractId}` };
    }

    function deploy(accountId: string, policyId: string) {
      return queue.enqueue(accountId, policyId, deployOne);
    }

    const [r1, r2, r3] = await Promise.all([
      deploy("WALLET-A", "p1"),
      deploy("WALLET-A", "p2"),
      deploy("WALLET-A", "p3"),
    ]);

    expect(attachOrder).toEqual(["C-p1", "C-p2", "C-p3"]);
    expect([r1.contractId, r2.contractId, r3.contractId]).toEqual(["C-p1", "C-p2", "C-p3"]);
  });
});
