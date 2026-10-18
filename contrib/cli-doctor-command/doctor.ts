/**
 * REFERENCE IMPLEMENTATION
 * This is a complete working example of the doctor command for issue #605.
 * Copy/adapt this into packages/cli/src/commands/doctor.ts
 */

import { Command } from "commander";
import { DEFAULT_FACILITATOR_URL } from "./search.js";

const REQUIRED_NODE_VERSION = 20;

/**
 * Check if the running Node.js version meets the minimum requirement.
 * Returns { pass: true } on success or { pass: false, message: string } on failure.
 */
export function checkNodeVersion(): { pass: boolean; message: string } {
  const current = parseInt(process.version.slice(1).split(".")[0], 10);
  if (current >= REQUIRED_NODE_VERSION) {
    return {
      pass: true,
      message: `Node.js version ${process.version} (required: >=${REQUIRED_NODE_VERSION})`,
    };
  }
  return {
    pass: false,
    message: `Node.js version ${process.version} is below required ${REQUIRED_NODE_VERSION}`,
  };
}

/**
 * Check if the facilitator URL is reachable by making a HEAD request.
 * Returns { pass: true } on success or { pass: false, message: string } on failure.
 */
export async function checkFacilitatorReachability(url: string): Promise<{
  pass: boolean;
  message: string;
}> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    // Accept any non-500 response as "reachable" — we're checking connectivity, not health.
    if (response.status >= 500) {
      return {
        pass: false,
        message: `Facilitator returned ${response.status} ${response.statusText}`,
      };
    }
    return {
      pass: true,
      message: `Facilitator is reachable at ${url}`,
    };
  } catch (err) {
    return {
      pass: false,
      message: `Could not reach facilitator at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check for the presence of a signer key in the expected locations:
 * 1. --secret-file <path>
 * 2. --secret <key>
 * 3. VELLAR_SECRET environment variable
 * Returns { pass: true } on success or { pass: false, message: string } on failure.
 * Never prints the key itself.
 */
export async function checkSignerKey(opts: {
  secret?: string;
  secretFile?: string;
}): Promise<{ pass: boolean; message: string }> {
  // Check --secret-file first (most preferred)
  if (opts.secretFile) {
    try {
      const { readFile } = await import("node:fs/promises");
      const content = (await readFile(opts.secretFile, "utf8")).trim();
      if (content.length > 0) {
        return {
          pass: true,
          message: `Signer key found at ${opts.secretFile}`,
        };
      }
    } catch (err) {
      return {
        pass: false,
        message: `Could not read signer key from ${opts.secretFile}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Check --secret flag (not preferred, but still valid)
  if (opts.secret) {
    return {
      pass: true,
      message: "Signer key found in --secret flag",
    };
  }

  // Check VELLAR_SECRET environment variable
  if (process.env.VELLAR_SECRET) {
    return {
      pass: true,
      message: "Signer key found in VELLAR_SECRET environment variable",
    };
  }

  return {
    pass: false,
    message: "No signer key found (check --secret-file, --secret, or VELLAR_SECRET)",
  };
}

export function makeDoctorCommand(): Command {
  return new Command("doctor")
    .description("Check environment readiness for vellar CLI")
    .option("--secret <key>", "Payer secret key (S...)", process.env.VELLAR_SECRET)
    .option("--secret-file <path>", "Path to a file containing the secret key")
    .option("--facilitator <url>", "Facilitator URL", process.env.VELLAR_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL)
    .action(
      async (opts: {
        secret?: string;
        secretFile?: string;
        facilitator: string;
      }) => {
        try {
          const checks = [];

          // 1. Node.js version check
          const nodeCheck = checkNodeVersion();
          checks.push({
            name: "Node.js version",
            ...nodeCheck,
          });

          // 2. Facilitator reachability check
          const facilitatorCheck = await checkFacilitatorReachability(opts.facilitator);
          checks.push({
            name: "Facilitator reachability",
            ...facilitatorCheck,
          });

          // 3. Signer key presence check
          const signerCheck = await checkSignerKey({
            secret: opts.secret,
            secretFile: opts.secretFile,
          });
          checks.push({
            name: "Signer key",
            ...signerCheck,
          });

          // Print results
          console.log("Environment checks:");
          for (const check of checks) {
            const status = check.pass ? "✓" : "✗";
            console.log(`${status} ${check.name}: ${check.message}`);
          }

          // Exit with non-zero if any check failed
          const allPassed = checks.every((c) => c.pass);
          if (!allPassed) {
            process.exit(1);
          }
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      },
    );
}
