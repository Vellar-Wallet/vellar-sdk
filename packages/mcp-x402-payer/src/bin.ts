#!/usr/bin/env node
// Entry point: read config, build everything once, serve stdio.
//
// Startup order matters. The secret is registered with the redactor BEFORE any
// other component exists, so there is no window in which a failure could print
// it. Config errors exit non-zero with an actionable message on stderr — never
// on stdout, which belongs to the MCP transport.

import { loadConfig } from "./config.js";
import { createSpendLedger } from "./ledger.js";
import { formatError, log, registerSecret } from "./output.js";
import { createPayer } from "./payer.js";
import { createMcpServer, startStdio } from "./server.js";
import { createOfficialSigner } from "./signer.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // First thing after parsing: nothing emitted from here on can carry it.
  registerSecret(config.secret);

  const ledger = createSpendLedger(config.ceilings);
  // Built once: the keypair is derived a single time, and a malformed secret
  // fails here rather than at the first payment.
  const signer = createOfficialSigner(config);
  const payer = createPayer({ config, ledger, signer });

  log("info", "vellar x402 payer ready", {
    network: config.network,
    payer: signer.address,
    assets: config.allowedAssets.length,
  });

  await startStdio(createMcpServer({ payer, config, ledger }));
}

main().catch((err) => {
  // formatError strips stacks and redacts; a config failure must not echo the key.
  process.stderr.write(`vellar-mcp-x402-payer failed to start: ${formatError(err)}\n`);
  process.exit(1);
});
