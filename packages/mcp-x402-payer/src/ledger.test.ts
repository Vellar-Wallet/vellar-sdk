import { describe, expect, it } from "vitest";
import {
  createDurableSpendLedger,
  createSpendLedger,
  DurableLedgerStoreError,
  type DurableLedgerStore,
} from "./ledger.js";

const ASSET_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

describe("SpendLedger with DurableLedgerStore", () => {
  it("defaults to in-memory behavior when no store is provided", async () => {
    const ceilings = new Map([[ASSET_A, 1000n]]);
    const ledger = createSpendLedger(ceilings);

    expect(ledger.remainingFor(ASSET_A)).toBe(1000n);
    await ledger.record(ASSET_A, 300n);
    expect(ledger.remainingFor(ASSET_A)).toBe(700n);
  });

  it("persists spend across restarts via DurableLedgerStore", async () => {
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

    // Process 1: run payments
    const ledger1 = await createDurableSpendLedger(ceilings, store);
    expect(ledger1.remainingFor(ASSET_A)).toBe(1000n);
    await ledger1.record(ASSET_A, 400n);
    expect(ledger1.remainingFor(ASSET_A)).toBe(600n);

    // Process 2: restart process and reload ledger from store
    const ledger2 = await createDurableSpendLedger(ceilings, store);
    expect(ledger2.remainingFor(ASSET_A)).toBe(600n);
    await ledger2.record(ASSET_A, 200n);
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
    const ledger = createSpendLedger(ceilings, failingStore);

    await expect(ledger.record(ASSET_A, 100n)).rejects.toBeInstanceOf(DurableLedgerStoreError);
  });

  it("fails CLOSED when store load fails on startup", async () => {
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
