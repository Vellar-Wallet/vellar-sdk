// Example: a `checkReadiness` helper for @vellar/mcp-x402-payer consumers.
//
// The payer package only validates its environment implicitly, by throwing
// from `loadConfig` at startup. That is fine for the server itself, but a
// consumer that wants to verify configuration ahead of time — in a health
// check, a setup wizard, or a CI smoke test — has no way to ask "is this
// ready?" without actually booting the server and catching whatever it
// throws. This mirrors the package's own env parsing (see
// packages/mcp-x402-payer/src/config.ts) as a standalone, side-effect-free
// check that never reads or logs the secret itself.
//
// Run with: npx tsx readiness-check.ts

export interface ReadinessIssue {
  /** The environment variable this issue is about. */
  variable: string;
  /** Human-readable explanation, safe to print or log. */
  message: string;
}

export interface ReadinessResult {
  ready: boolean;
  /** Empty when `ready` is true. */
  issues: ReadinessIssue[];
}

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const SECRET_SEED_RE = /^S[A-Z2-7]{55}$/;

function isValidContractId(value: string): boolean {
  return CONTRACT_ID_RE.test(value);
}

function isValidSecretSeed(value: string): boolean {
  return SECRET_SEED_RE.test(value);
}

/**
 * Checks whether the environment has everything @vellar/mcp-x402-payer needs
 * to start, without starting it and without ever reading file contents or
 * logging secret material. `env` defaults to `process.env` but can be an
 * arbitrary record for testing.
 *
 * This intentionally re-derives the package's own validation rules (see
 * `loadConfig` in packages/mcp-x402-payer/src/config.ts) rather than
 * importing them, since contributor examples are self-contained and must not
 * depend on the package's internals.
 */
export function checkReadiness(env: Record<string, string | undefined> = process.env): ReadinessResult {
  const issues: ReadinessIssue[] = [];

  const secretFile = env.VELLAR_X402_SECRET_FILE?.trim();
  const secretInline = env.VELLAR_X402_SECRET?.trim();

  if (secretFile && secretInline) {
    issues.push({
      variable: "VELLAR_X402_SECRET / VELLAR_X402_SECRET_FILE",
      message: "Set exactly one of these, not both.",
    });
  } else if (!secretFile && !secretInline) {
    issues.push({
      variable: "VELLAR_X402_SECRET",
      message:
        "No payer secret configured. Set VELLAR_X402_SECRET (an S... ed25519 secret) " +
        "or VELLAR_X402_SECRET_FILE (a path to a file containing one).",
    });
  } else if (secretInline && !isValidSecretSeed(secretInline)) {
    issues.push({
      variable: "VELLAR_X402_SECRET",
      message: "Value is not a valid Stellar ed25519 secret seed (S...).",
    });
  }
  // A secret sourced from VELLAR_X402_SECRET_FILE is not validated here: doing
  // so would mean reading the file, and this check must never touch secret
  // material. The package itself validates the file's contents at startup.

  const network = env.VELLAR_X402_NETWORK?.trim();
  if (network !== undefined && network !== "" && network !== "testnet" && network !== "mainnet") {
    issues.push({
      variable: "VELLAR_X402_NETWORK",
      message: `Must be "testnet" or "mainnet", got "${network}".`,
    });
  }

  const assetsRaw = env.VELLAR_X402_ASSETS?.trim();
  if (!assetsRaw) {
    issues.push({
      variable: "VELLAR_X402_ASSETS",
      message:
        "At least one <assetContractId>:<sessionCeiling> pair is required, comma-separated.",
    });
  } else {
    const seen = new Set<string>();
    let sawValidEntry = false;
    for (const entry of assetsRaw.split(",")) {
      const trimmed = entry.trim();
      if (trimmed === "") continue;

      const parts = trimmed.split(":");
      if (parts.length !== 2) {
        issues.push({
          variable: "VELLAR_X402_ASSETS",
          message: `Entry "${trimmed}" is malformed. Expected "<assetContractId>:<sessionCeilingBaseUnits>".`,
        });
        continue;
      }
      const [asset, ceilingRaw] = parts.map((p) => p.trim());

      if (!asset || !isValidContractId(asset)) {
        issues.push({
          variable: "VELLAR_X402_ASSETS",
          message: `"${asset}" is not a Soroban contract id (C...).`,
        });
        continue;
      }
      if (!ceilingRaw || !/^\d+$/.test(ceilingRaw)) {
        issues.push({
          variable: "VELLAR_X402_ASSETS",
          message: `Ceiling for ${asset} must be a non-negative integer in base units, got "${ceilingRaw}".`,
        });
        continue;
      }
      if (BigInt(ceilingRaw) === 0n) {
        issues.push({
          variable: "VELLAR_X402_ASSETS",
          message: `Ceiling for ${asset} is 0, which would refuse every payment.`,
        });
        continue;
      }
      if (seen.has(asset)) {
        issues.push({
          variable: "VELLAR_X402_ASSETS",
          message: `Asset ${asset} is listed more than once.`,
        });
        continue;
      }
      seen.add(asset);
      sawValidEntry = true;
    }
    if (!sawValidEntry && !issues.some((i) => i.variable === "VELLAR_X402_ASSETS")) {
      issues.push({
        variable: "VELLAR_X402_ASSETS",
        message: "No usable <assetContractId>:<sessionCeiling> pairs were found.",
      });
    }
  }

  const walletAddress = env.VELLAR_X402_WALLET?.trim();
  if (walletAddress && !isValidContractId(walletAddress)) {
    issues.push({
      variable: "VELLAR_X402_WALLET",
      message: `Must be a Soroban contract id (C...), got "${walletAddress}".`,
    });
  }

  const policiesRaw = env.VELLAR_X402_POLICIES?.trim();
  if (policiesRaw) {
    const policies = policiesRaw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    for (const policy of policies) {
      if (!isValidContractId(policy)) {
        issues.push({
          variable: "VELLAR_X402_POLICIES",
          message: `"${policy}" is not a Soroban contract id (C...).`,
        });
      }
    }
    if (policies.length > 0 && !walletAddress) {
      issues.push({
        variable: "VELLAR_X402_POLICIES",
        message: "Policies are set but VELLAR_X402_WALLET is not. Policies only apply to a smart account signer.",
      });
    }
  }

  const maxResponseBytesRaw = env.VELLAR_X402_MAX_RESPONSE_BYTES?.trim();
  if (maxResponseBytesRaw) {
    if (!/^\d+$/.test(maxResponseBytesRaw) || Number(maxResponseBytesRaw) <= 0) {
      issues.push({
        variable: "VELLAR_X402_MAX_RESPONSE_BYTES",
        message: `Must be a positive integer, got "${maxResponseBytesRaw}".`,
      });
    }
  }

  return { ready: issues.length === 0, issues };
}

function main() {
  const notReady = checkReadiness({});
  console.log("Empty environment:");
  console.log(JSON.stringify(notReady, null, 2));

  const ready = checkReadiness({
    VELLAR_X402_SECRET: "SBPTZAOFHOKY7ZZE7HGXXVGWCVTAMLLI4KYY2EI7DGZY6L4KTAWWZ2XY",
    VELLAR_X402_ASSETS: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND:5000000",
    VELLAR_X402_NETWORK: "testnet",
  });
  console.log("\nFully configured environment:");
  console.log(JSON.stringify(ready, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
