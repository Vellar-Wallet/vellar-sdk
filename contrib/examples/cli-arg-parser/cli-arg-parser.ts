// Example: a minimal CLI argument parser reading named flags and
// positional arguments from a process.argv-style array.
//
// Supported flag styles: --key=value, and a bare --key (boolean true).
// Everything else (including anything not starting with --) is a
// positional.
//
// Deliberately NOT supporting "--key value" (space-separated): without a
// predefined schema of which flags take a value, that form is ambiguous —
// `--dry-run positional1` can't be told apart from `--amount 100` without
// knowing in advance whether --dry-run is boolean-only. Requiring `=` for
// any flag that takes a value sidesteps the ambiguity entirely.
//
// Run with: npx tsx cli-arg-parser.ts --network=testnet --dry-run positional1 --amount=100 positional2

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (const token of argv) {
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eqIndex = body.indexOf("=");

      if (eqIndex !== -1) {
        flags[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
      } else {
        flags[body] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

function main() {
  const sampleArgv = ["--network=testnet", "--dry-run", "positional1", "--amount=100", "positional2"];
  console.log("Input: ", sampleArgv);
  console.log("Parsed:", parseArgs(sampleArgv));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
