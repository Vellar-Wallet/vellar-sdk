import { describe, expect, it } from "vitest";
import { makeBalanceCommand } from "./balance.js";

describe("balance command", () => {
  it("requires an address and registers network, token, and JSON options", () => {
    const command = makeBalanceCommand();
    expect(command.name()).toBe("balance");
    expect(command.registeredArguments[0]?.required).toBe(true);
    expect(command.options.map((option) => option.long)).toEqual([
      "--network",
      "--token",
      "--json",
    ]);
  });
});