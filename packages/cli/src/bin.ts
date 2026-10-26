#!/usr/bin/env node
import { Command } from "commander";
import { makeSearchCommand } from "./commands/search.js";
import { makeQuoteCommand } from "./commands/quote.js";
import { makePayCommand } from "./commands/pay.js";
import { makeInspectCommand } from "./commands/inspect.js";
import { printStartupBanner } from "./banner.js";

const program = new Command();

program
  .name("vellar")
  .description("CLI for discovering, quoting, paying for, and inspecting x402 resources on Stellar")
  .version("0.1.0")
  .option("--quiet", "Suppress the startup banner reporting resolved network/facilitator")
  .hook("preAction", printStartupBanner);

program.addCommand(makeSearchCommand());
program.addCommand(makeQuoteCommand());
program.addCommand(makePayCommand());
program.addCommand(makeInspectCommand());

program.parse();
