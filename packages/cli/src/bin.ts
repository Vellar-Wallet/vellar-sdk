#!/usr/bin/env node
import { createRequire } from "module";
import { Command } from "commander";
import { makeSearchCommand } from "./commands/search.js";
import { makeQuoteCommand } from "./commands/quote.js";
import { makePayCommand } from "./commands/pay.js";
import { makeInspectCommand } from "./commands/inspect.js";

// Read the version from package.json rather than hardcoding it, so `vellar
// --version` cannot drift from what's actually published.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("vellar")
  .description("CLI for discovering, quoting, paying for, and inspecting x402 resources on Stellar")
  .version(pkg.version);

program.addCommand(makeSearchCommand());
program.addCommand(makeQuoteCommand());
program.addCommand(makePayCommand());
program.addCommand(makeInspectCommand());

program.parse();
