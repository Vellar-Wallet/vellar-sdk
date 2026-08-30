import { describe, expect, it } from "vitest";
import { validateConfig, type FieldSchema } from "./config-validator";

const schema: FieldSchema[] = [
  { name: "network", type: "string" },
  { name: "appName", type: "string" },
  { name: "rpcUrl", type: "string" },
  { name: "enableX402", type: "boolean" },
];

describe("validateConfig", () => {
  it("returns no errors for a valid config", () => {
    const config = { network: "testnet", appName: "My App", rpcUrl: "https://rpc.example", enableX402: true };
    expect(validateConfig(config, schema)).toEqual([]);
  });

  it("reports a missing field", () => {
    const config = { network: "testnet", rpcUrl: "https://rpc.example", enableX402: true };
    expect(validateConfig(config, schema)).toEqual(['Missing required field "appName"']);
  });

  it("reports a type mismatch", () => {
    const config = { network: "testnet", appName: "My App", rpcUrl: "https://rpc.example", enableX402: "yes" };
    expect(validateConfig(config, schema)).toEqual([
      'Field "enableX402" expected type "boolean", got "string"',
    ]);
  });

  it("reports every issue, not just the first", () => {
    const config = { network: "testnet", rpcUrl: 12345, enableX402: "yes" };
    const errors = validateConfig(config, schema);
    expect(errors).toEqual([
      'Missing required field "appName"',
      'Field "rpcUrl" expected type "string", got "number"',
      'Field "enableX402" expected type "boolean", got "string"',
    ]);
  });

  it("distinguishes array from object", () => {
    const errors = validateConfig({ tags: [] }, [{ name: "tags", type: "object" }]);
    expect(errors).toEqual(['Field "tags" expected type "object", got "array"']);
  });

  it("ignores fields in config that are not in the schema", () => {
    const config = { network: "testnet", appName: "x", rpcUrl: "y", enableX402: false, extra: "unchecked" };
    expect(validateConfig(config, schema)).toEqual([]);
  });
});
