// Sample runner: demonstrates listing templates and picking a valid index,
// then shows the error path for an out-of-range index.

import { listTemplates, printTemplateSchema, POLICY_TEMPLATES } from "./picker";

console.log("=== Listing all templates ===\n");
listTemplates();

console.log("\n=== Selecting template at index 0 ===");
printTemplateSchema("0");

console.log("\n=== Selecting template at index 2 ===");
printTemplateSchema("2");

console.log(`\n=== Out-of-range index (${POLICY_TEMPLATES.length}) ===`);
printTemplateSchema(String(POLICY_TEMPLATES.length));
