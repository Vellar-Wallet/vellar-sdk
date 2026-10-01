import { describe, expect, it } from "vitest";
import {
  createDurableSpendLedger,
  DurableLedgerStoreError,
  type DurableLedgerStore,
} from "./durable-mcp-ledger";

const ASSET_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

describe("durable-mcp-ledger (#414)", () => {
  it("persists spend across process restarts using DurableLedgerStore", async () => {
    const memoryBackend = new Map<string, string>();
    const store: DurableLedgerStore = {
      load: () => Object.fromEntries(memoryBackend.entries()),
      save: (snap) => {
        memoryBackend.clear();
        for (const [k, v] of Object.entries(snap)) {
          memoryBackend.set(k, v);
        }
      },
    };

    const ceilings = new Map([[ASSET_A, 1000n]]);

    // Instance 1
    const ledger1 = await createDurableSpendLedger(ceilings, store);
    expect(ledger1.remainingFor(ASSET_A)).toBe(1000n);
    await ledger1.recordAndPersist(ASSET_A, 400n);
    expect(ledger1.remainingFor(ASSET_A)).toBe(600n);

    // Instance 2 (restart simulation)
    const ledger2 = await createDurableSpendLedger(ceilings, store);
    expect(ledger2.remainingFor(ASSET_A)).toBe(600n);
    await ledger2.recordAndPersist(ASSET_A, 200n);
    expect(ledger2.remainingFor(ASSET_A)).toBe(400n);
  });

  it("fails CLOSED when store save fails", async () => {
    const failingStore: DurableLedgerStore = {
      load: () => ({}),
      save: () => {
        throw new Error("Disk full");
      },
    };

    const ceilings = new Map([[ASSET_A, 1000n]]);
    const ledger = await createDurableSpendLedger(ceilings, failingStore);

    await expect(ledger.recordAndPersist(ASSET_A, 100n)).rejects.toBeInstanceOf(
      DurableLedgerStoreError,
    );
  });

  it("fails CLOSED when store load fails", async () => {
    const failingStore: DurableLedgerStore = {
      load: () => {
        throw new Error("Permission denied");
      },
      save: () => {},
    };

    const ceilings = new Map([[ASSET_A, 1000n]]);
    await expect(createDurableSpendLedger(ceilings, failingStore)).rejects.toBeInstanceOf(
      DurableLedgerStoreError,
    );
  });
});
