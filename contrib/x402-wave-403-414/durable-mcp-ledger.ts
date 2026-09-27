import {
  createSpendLedger,
  type SpendLedger,
} from "../../packages/mcp-x402-payer/src/ledger";

export interface DurableLedgerStore {
  load(): Promise<Record<string, string>> | Record<string, string>;
  save(snapshot: Record<string, string>): Promise<void> | void;
}

export class DurableLedgerStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DurableLedgerStoreError";
  }
}

export function createFileLedgerStore(filePath: string): DurableLedgerStore {
  return {
    async load(): Promise<Record<string, string>> {
      const { readFile } = await import("node:fs/promises");
      try {
        const text = await readFile(filePath, "utf8");
        return JSON.parse(text);
      } catch (err: any) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          return {};
        }
        throw new DurableLedgerStoreError(
          `Could not load durable spend ledger from ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    },

    async save(snapshot: Record<string, string>): Promise<void> {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      try {
        const dir = dirname(filePath);
        if (dir && dir !== ".") {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
      } catch (err) {
        throw new DurableLedgerStoreError(
          `Could not save durable spend ledger to ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    },
  };
}

export interface DurableSpendLedgerWrapper extends SpendLedger {
  recordAndPersist(asset: string, amount: bigint): Promise<void>;
}

export function createDurableSpendLedgerWrapper(
  ceilings: ReadonlyMap<string, bigint>,
  store: DurableLedgerStore,
  initialSpent: Record<string, string> = {},
): DurableSpendLedgerWrapper {
  const baseLedger = createSpendLedger(ceilings);

  for (const [asset, val] of Object.entries(initialSpent)) {
    try {
      baseLedger.record(asset, BigInt(val));
    } catch {
      // Ignore invalid initial values
    }
  }

  return {
    assertWithinCeiling(asset, amount) {
      baseLedger.assertWithinCeiling(asset, amount);
    },

    record(asset, amount) {
      baseLedger.record(asset, amount);
    },

    async recordAndPersist(asset, amount) {
      baseLedger.record(asset, amount);
      const snapshotMap: Record<string, string> = {};
      for (const item of baseLedger.snapshot()) {
        snapshotMap[item.asset] = item.spent;
      }
      try {
        await store.save(snapshotMap);
      } catch (err) {
        throw new DurableLedgerStoreError(
          `Failed to persist spend ledger state: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    },

    remainingFor(asset) {
      return baseLedger.remainingFor(asset);
    },

    snapshot() {
      return baseLedger.snapshot();
    },
  };
}

export async function createDurableSpendLedger(
  ceilings: ReadonlyMap<string, bigint>,
  store: DurableLedgerStore,
): Promise<DurableSpendLedgerWrapper> {
  let initialSpent: Record<string, string> = {};
  try {
    initialSpent = await store.load();
  } catch (err) {
    throw new DurableLedgerStoreError(
      `Failed to load initial spend ledger state: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err,
    );
  }
  return createDurableSpendLedgerWrapper(ceilings, store, initialSpent);
}
