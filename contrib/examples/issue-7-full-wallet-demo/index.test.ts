import { describe, expect, it } from "vitest";
import { runFullWalletDemo } from "./index";

describe("runFullWalletDemo", () => {
  it("runs create -> connect -> pay -> policy attach end to end, logging each step", async () => {
    const logs: string[] = [];
    await runFullWalletDemo((line) => logs.push(line));

    expect(logs).toHaveLength(6);
    expect(logs[0]).toMatch(/^1\. create\(\)\s+-> account C/);
    expect(logs[1]).toMatch(/^2\. connect\(\)\s+-> account C/);
    expect(logs[2]).toMatch(/^3\. pay\(\)\s+-> tx mockhash/);
    expect(logs[3]).toMatch(/^4a\. policies\.generate\(\)\s+-> policy policy-/);
    expect(logs[4]).toBe("4b. policies.simulate() -> ok=true");
    expect(logs[5]).toMatch(/^4c\. policies\.deploy\(\)\s+-> attached, contract C/);

    // create() and connect() resolve to the SAME account (fresh session, same wallet).
    const createdAccount = logs[0]!.match(/account (C\S+)/)![1];
    const connectedAccount = logs[1]!.match(/account (C\S+)/)![1];
    expect(connectedAccount).toBe(createdAccount);
  });

  it("runs with the default console logger when none is given", async () => {
    await expect(runFullWalletDemo()).resolves.toBeUndefined();
  });
});
