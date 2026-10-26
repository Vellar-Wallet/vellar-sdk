import type { Command } from "commander";
import { shouldLog } from "vellar-sdk/log-level";

/**
 * Where a resolved CLI option value actually came from (#677).
 *
 * commander's own `getOptionValueSource` only distinguishes "cli" from
 * "default" here, because every `--network`/`--facilitator` option in this
 * package bakes its env var read into the *default value* expression
 * (`process.env.VELLAR_NETWORK ?? "testnet"`), not via commander's `.env()`
 * hook, so commander itself can never see that an env var was consulted.
 * This module re-derives the real source by checking the env var directly.
 */
export type OptionSource = "flag" | "env" | "default";

export interface ResolvedOption {
  name: string;
  value: string;
  source: OptionSource;
  envVar?: string;
}

/**
 * Resolves one option's value and where it came from, given the action
 * command commander invoked (post-parse, so `.opts()` reflects flags/env/
 * defaults already applied) and the env var this option's default reads.
 *
 * Returns undefined if the command doesn't define this option at all:
 * not every subcommand takes `--network`/`--facilitator` (e.g. `quote`
 * takes neither), and the banner should simply omit what isn't there.
 */
export function resolveOption(
  command: Command,
  optionName: string,
  envVar?: string,
): ResolvedOption | undefined {
  const opts = command.opts();
  if (!(optionName in opts)) return undefined;

  const value = opts[optionName] as string;
  const source: OptionSource =
    command.getOptionValueSource(optionName) === "cli"
      ? "flag"
      : envVar && process.env[envVar] !== undefined
        ? "env"
        : "default";

  return { name: optionName, value, source, envVar };
}

function formatSource(resolved: ResolvedOption): string {
  switch (resolved.source) {
    case "flag":
      return "flag";
    case "env":
      return `env ${resolved.envVar}`;
    case "default":
      return "default";
  }
}

/**
 * Prints the startup banner for `actionCommand`: one line per resolved
 * option that command actually defines, naming the value and whether it
 * came from a flag, an environment variable, or the built-in default.
 *
 * Call from `program.hook("preAction", (thisCommand, actionCommand) => ...)`
 * so it runs before any subcommand's own action, regardless of which
 * subcommand was invoked. `quiet` is read from `thisCommand` (the root
 * `--quiet` flag) rather than `actionCommand`, since not every subcommand
 * necessarily re-declares it. Also suppressed when the shared
 * VELLAR_LOG_LEVEL (#678) is set above "info", `--quiet` is a one-off per
 * invocation, VELLAR_LOG_LEVEL is the standing convention.
 */
export function printStartupBanner(thisCommand: Command, actionCommand: Command): void {
  if ((thisCommand.opts() as Record<string, unknown>).quiet) return;
  // The banner is informational, not an error a user needs to see even
  // with VELLAR_LOG_LEVEL turned down (#678's shared convention).
  if (!shouldLog("info")) return;

  const resolved = [
    resolveOption(actionCommand, "network", "VELLAR_NETWORK"),
    resolveOption(actionCommand, "facilitator", "VELLAR_FACILITATOR_URL"),
  ].filter((r): r is ResolvedOption => r !== undefined);

  if (resolved.length === 0) return;

  const parts = resolved.map((r) => `${r.name}=${r.value} (${formatSource(r)})`);
  console.error(`vellar ${actionCommand.name()}: ${parts.join(", ")}`);
}
