// Policy Template Picker CLI
//
// Usage: npx ts-node picker.ts <index>
//
// Lists available mock policy templates (index 0-based).
// Provide an index to print that template's parameter schema.

import type { PolicyTemplateInfo, Enforcement } from "../../../src/policy-types";

interface TemplateWithParams extends PolicyTemplateInfo {
  params: Record<string, { type: string; required: boolean; description: string }>;
}

export const POLICY_TEMPLATES: TemplateWithParams[] = [
  {
    type: "spending-limit-daily",
    title: "Daily Spending Limit",
    description:
      "Caps total spend per rolling 24-hour window; enforced on-chain by a deployed policy contract.",
    enforcement: {
      kind: "policy-contract",
      wasmHash: "mock-wasm-hash-spending-limit",
      constructorArgs: { dailyLimitStroops: "10000000", windowSeconds: 86400 },
    },
    params: {
      dailyLimitStroops: {
        type: "string (stroops)",
        required: true,
        description: "Maximum spend in stroops per rolling 24-hour window (1 XLM = 10,000,000 stroops).",
      },
      windowSeconds: {
        type: "number",
        required: false,
        description: "Length of the rolling window in seconds. Defaults to 86400 (24 hours).",
      },
    },
  },
  {
    type: "session-key-only",
    title: "Session-Key Signer Limits",
    description:
      "Restricts a session key to a fixed set of contract calls; enforced by the wallet's signer limits.",
    enforcement: { kind: "signer-limits" },
    params: {
      allowedContractIds: {
        type: "string[]",
        required: true,
        description: "List of contract IDs the session key is permitted to invoke.",
      },
      allowedFunctionNames: {
        type: "string[]",
        required: false,
        description: "Optional allowlist of function names. Omit to permit all functions on the allowed contracts.",
      },
      expiresAt: {
        type: "number (unix timestamp)",
        required: false,
        description: "Unix timestamp after which the session key is considered expired.",
      },
    },
  },
  {
    type: "multi-signer-approval",
    title: "Multi-Signer Approval",
    description:
      "Requires M-of-N signers to approve a transaction before it is submitted.",
    enforcement: { kind: "policy-contract", wasmHash: "mock-wasm-hash-multisig" },
    params: {
      threshold: {
        type: "number",
        required: true,
        description: "Minimum number of signers whose approval is required (M).",
      },
      signers: {
        type: "string[] (Stellar public keys)",
        required: true,
        description: "Complete list of authorised signer public keys (N).",
      },
    },
  },
  {
    type: "unrestricted",
    title: "No Policy",
    description:
      "No spending restriction is attached; the wallet's normal signer thresholds apply.",
    enforcement: { kind: "none" },
    params: {},
  },
];

export function listTemplates(): void {
  console.log("Available policy templates:\n");
  POLICY_TEMPLATES.forEach((t, i) => {
    console.log(`  [${i}] ${t.title} (${t.type})`);
    console.log(`      ${t.description}`);
  });
  console.log(`\nRun with an index (0–${POLICY_TEMPLATES.length - 1}) to view that template's parameter schema.`);
}

export function printTemplateSchema(indexStr: string): void {
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0 || index >= POLICY_TEMPLATES.length) {
    console.error(
      `Error: index "${indexStr}" is out of range. Valid range is 0–${POLICY_TEMPLATES.length - 1}.`
    );
    process.exitCode = 1;
    return;
  }

  const template = POLICY_TEMPLATES[index];
  console.log(`\nTemplate [${index}]: ${template.title}`);
  console.log(`Type        : ${template.type}`);
  console.log(`Description : ${template.description}`);
  console.log(`Enforcement : ${JSON.stringify(template.enforcement)}`);

  const paramEntries = Object.entries(template.params);
  if (paramEntries.length === 0) {
    console.log("\nParameter schema: (none — this template takes no parameters)");
  } else {
    console.log("\nParameter schema:");
    for (const [name, meta] of paramEntries) {
      const req = meta.required ? "required" : "optional";
      console.log(`  ${name}`);
      console.log(`    type     : ${meta.type}`);
      console.log(`    required : ${req}`);
      console.log(`    desc     : ${meta.description}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === undefined) {
    listTemplates();
  } else {
    printTemplateSchema(arg);
  }
}
