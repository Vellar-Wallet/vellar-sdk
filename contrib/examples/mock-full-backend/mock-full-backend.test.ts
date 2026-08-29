import { describe, expect, it } from "vitest";
import { createMockVellarWallet, createMockWalletBackend } from "./mock-full-backend";

const token = { symbol: "USDC", contractId: "CUSDCMOCK", decimals: 7 };

describe("createMockWalletBackend", () => {
  it("returns undefined for a hash that was never submitted", () => {
    const backend = createMockWalletBackend();
    expect(backend.getTransaction("nope")).toBeUndefined();
  });

  it("records a submitted transaction, queryable by its returned hash", async () => {
    const backend = createMockWalletBackend();
    const { hash } = await backend.submitTransaction({ signedXdr: "xdr-1", network: "testnet" });

    const entry = backend.getTransaction(hash);
    expect(entry).toBeDefined();
    expect(entry?.signedXdr).toBe("xdr-1");
    expect(entry?.network).toBe("testnet");
  });

  it("gives every submission a distinct hash", async () => {
    const backend = createMockWalletBackend();
    const a = await backend.submitTransaction({ signedXdr: "xdr-a", network: "testnet" });
    const b = await backend.submitTransaction({ signedXdr: "xdr-b", network: "testnet" });
    expect(a.hash).not.toBe(b.hash);
  });

  it("lists transactions oldest first", async () => {
    const backend = createMockWalletBackend();
    await backend.submitTransaction({ signedXdr: "xdr-1", network: "testnet" });
    await backend.submitTransaction({ signedXdr: "xdr-2", network: "testnet" });

    const list = backend.listTransactions();
    expect(list).toHaveLength(2);
    expect(list[0]?.signedXdr).toBe("xdr-1");
    expect(list[1]?.signedXdr).toBe("xdr-2");
  });
});

describe("createMockVellarWallet — full create then pay sequence", () => {
  it("creates a wallet and completes a payment, recorded in the backend's ledger", async () => {
    const { wallet, backend } = createMockVellarWallet("testnet");

    const session = await wallet.create({ username: "demo-user" });
    expect(session.accountId).toBeTruthy();
    expect(session.connected).toBe(true);

    const result = await wallet.pay({ to: "GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 1_0000000n, token });

    expect(backend.getTransaction(result.hash)).toBeDefined();
    expect(backend.listTransactions()).toHaveLength(1);
  });

  it("accumulates multiple payments in the ledger across the same session", async () => {
    const { wallet, backend } = createMockVellarWallet("testnet");
    await wallet.create();

    await wallet.pay({ to: "GRECIPIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 1_0000000n, token });
    await wallet.pay({ to: "GRECIPIENT2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 2_0000000n, token });

    expect(backend.listTransactions()).toHaveLength(2);
  });
});
