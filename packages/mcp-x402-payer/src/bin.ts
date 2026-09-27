#!/usr/bin/env node
// Entry point: read config, build everything once, serve stdio.
//
// Startup order matters. The secret is registered with the redactor BEFORE any
// other component exists, so there is no window in which a failure could print
// it. Config errors exit non-zero with an actionable message on stderr — never
// on stdout, which belongs to the MCP transport.

import { loadConfig } from "./config.js";
import { createSpendLedger } from "./ledger.js";
import { createStartupDiagnosticEvent, formatError, log, registerSecret } from "./output.js";
import { createPayer } from "./payer.js";
import { runPreflight } from "./preflight.js";
import { createMcpServer, startStdio } from "./server.js";
import { createOfficialSigner, createSmartAccountSigner } from "./signer.js";

async function main(): Promise<void> {
  if (process.argv.includes("--preflight") || process.argv.includes("preflight")) {
    const result = await runPreflight();
    process.stderr.write(`vellar x402 preflight self-check: ${result.ok ? "PASSED" : "FAILED"}\n`);
    process.stderr.write(`effective spend mode: ${result.spendMode}\n`);
    if (!result.ok) {
      process.stderr.write(`problems found (${result.problems.length}):\n`);
      for (const problem of result.problems) {
        process.stderr.write(`  - ${problem}\n`);
      }
      process.exit(1);
    }
    process.stderr.write("all preflight checks passed.\n");
    process.exit(0);
  }

  const config = loadConfig();

  // First thing after parsing: nothing emitted from here on can carry it.
  registerSecret(config.secret);

  const ledger = createSpendLedger(config.ceilings);
  // Built once: the key is derived a single time, and a malformed secret fails
  // here rather than at the first payment. A configured wallet selects the
  // smart-account path, where the spending limit is enforced on-chain.
  const smartAccount = config.walletAddress !== undefined;
  const signer = smartAccount ? createSmartAccountSigner(config) : createOfficialSigner(config);
  const payer = createPayer({ config, ledger, signer });

  const diagnostic = createStartupDiagnosticEvent({
    network: config.network,
    payer: signer.address,
    assets: config.allowedAssets.length,
    smartAccount,
    ...(smartAccount ? { policies: config.policies.length } : {}),
  });

  log("info", "vellar x402 payer ready", diagnostic as unknown as Record<string, unknown>);

  await startStdio(createMcpServer({ payer, config, ledger }));
}

main().catch((err) => {
  // formatError strips stacks and redacts; a config failure must not echo the key.
  process.stderr.write(`vellar-mcp-x402-payer failed to start: ${formatError(err)}\n`);
  process.exit(1);
});

