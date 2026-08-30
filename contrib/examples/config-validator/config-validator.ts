// Example: validate a plain configuration object against a small schema of
// required field names and expected types, collecting every problem instead
// of throwing on the first one.
//
// Run with: npx tsx config-validator.ts

export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface FieldSchema {
  name: string;
  type: FieldType;
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Validates `config` against `schema`: every listed field must be present
 * and match the declared type. Returns a list of human-readable error
 * messages — empty when the config is valid. Every issue is reported, not
 * just the first, so a caller can show a user all their mistakes at once.
 */
export function validateConfig(config: Record<string, unknown>, schema: FieldSchema[]): string[] {
  const errors: string[] = [];

  for (const field of schema) {
    if (!(field.name in config)) {
      errors.push(`Missing required field "${field.name}"`);
      continue;
    }
    const found = actualType(config[field.name]);
    if (found !== field.type) {
      errors.push(`Field "${field.name}" expected type "${field.type}", got "${found}"`);
    }
  }

  return errors;
}

function main() {
  const schema: FieldSchema[] = [
    { name: "network", type: "string" },
    { name: "appName", type: "string" },
    { name: "rpcUrl", type: "string" },
    { name: "enableX402", type: "boolean" },
  ];

  const validConfig = { network: "testnet", appName: "My App", rpcUrl: "https://rpc.example", enableX402: true };
  const brokenConfig = { network: "testnet", rpcUrl: 12345, enableX402: "yes" };

  console.log("Valid config errors:", validateConfig(validConfig, schema));
  console.log("Broken config errors:", validateConfig(brokenConfig, schema));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
