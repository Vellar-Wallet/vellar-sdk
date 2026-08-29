import { StrKey } from "@stellar/stellar-sdk";

import type { PayerNetwork } from "./config.js";

export type ReadinessIssueCode =
  | "missing-secret"
  | "invalid-secret"
  | "missing-assets"
  | "invalid-assets"
  | "invalid-network"
  | "invalid-rpc-url"
  | "invalid-wallet"
  | "invalid-policies";

export interface ReadinessIssue {
  code: ReadinessIssueCode;
  field: string;
  message: string;
}

export interface ReadinessResult {
  ready: boolean;
  issues: ReadonlyArray<ReadinessIssue>;
}

export interface ReadinessEnv {
  VELLAR_X402_SECRET?: string;
  VELLAR_X402_SECRET_FILE?: string;
  VELLAR_X402_ASSETS?: string;
  VELLAR_X402_NETWORK?: string;
  VELLAR_X402_RPC_URL?: string;
  VELLAR_X402_WALLET?: string;
  VELLAR_X402_POLICIES?: string;
}

function issue(
  code: ReadinessIssueCode,
  field: string,
  message: string,
): ReadinessIssue {
  return { code, field, message };
}

export function checkReadiness(
  env: ReadinessEnv = process.env,
): ReadinessResult {
  const issues: ReadinessIssue[] = [];

  const secret = env.VELLAR_X402_SECRET?.trim();
  const secretFile = env.VELLAR_X402_SECRET_FILE?.trim();

  if (!secret && !secretFile) {
    issues.push(
      issue(
        "missing-secret",
        "VELLAR_X402_SECRET",
        "Configure VELLAR_X402_SECRET or VELLAR_X402_SECRET_FILE.",
      ),
    );
  } else if (secret && secretFile) {
    issues.push(
      issue(
        "invalid-secret",
        "VELLAR_X402_SECRET",
        "Configure exactly one payer secret source.",
      ),
    );
  } else if (secret && !StrKey.isValidEd25519SecretSeed(secret)) {
    issues.push(
      issue(
        "invalid-secret",
        "VELLAR_X402_SECRET",
        "The configured payer secret is not a valid Stellar ed25519 secret seed.",
      ),
    );
  }

  const network = (env.VELLAR_X402_NETWORK ?? "testnet").trim();

  if (network !== "testnet" && network !== "mainnet") {
    issues.push(
      issue(
        "invalid-network",
        "VELLAR_X402_NETWORK",
        "Network must be testnet or mainnet.",
      ),
    );
  }

  const assets = env.VELLAR_X402_ASSETS?.trim();

  if (!assets) {
    issues.push(
      issue(
        "missing-assets",
        "VELLAR_X402_ASSETS",
        "Configure at least one asset and session ceiling.",
      ),
    );
  } else {
    for (const entry of assets.split(",")) {
      const parts = entry.trim().split(":");

      if (parts.length !== 2) {
        issues.push(
          issue(
            "invalid-assets",
            "VELLAR_X402_ASSETS",
            `Invalid asset entry: ${entry.trim()}`,
          ),
        );
        continue;
      }

      const asset = parts[0]?.trim();
      const ceiling = parts[1]?.trim();

      if (!asset || !StrKey.isValidContract(asset)) {
        issues.push(
          issue(
            "invalid-assets",
            "VELLAR_X402_ASSETS",
            "Every asset must be a valid Soroban contract ID.",
          ),
        );
      }

      if (!ceiling || !/^\d+$/.test(ceiling) || BigInt(ceiling) <= 0n) {
        issues.push(
          issue(
            "invalid-assets",
            "VELLAR_X402_ASSETS",
            "Every asset must have a positive integer session ceiling.",
          ),
        );
      }
    }
  }

  if (env.VELLAR_X402_RPC_URL?.trim()) {
    try {
      const url = new URL(env.VELLAR_X402_RPC_URL.trim());

      if (url.protocol !== "https:") {
        issues.push(
          issue(
            "invalid-rpc-url",
            "VELLAR_X402_RPC_URL",
            "RPC URL must use HTTPS.",
          ),
        );
      }
    } catch {
      issues.push(
        issue(
          "invalid-rpc-url",
          "VELLAR_X402_RPC_URL",
          "RPC URL must be a valid URL.",
        ),
      );
    }
  }

  const wallet = env.VELLAR_X402_WALLET?.trim();

  if (wallet && !StrKey.isValidContract(wallet)) {
    issues.push(
      issue(
        "invalid-wallet",
        "VELLAR_X402_WALLET",
        "Wallet must be a valid Soroban contract ID.",
      ),
    );
  }

  const policies = env.VELLAR_X402_POLICIES
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (policies?.length && !wallet) {
    issues.push(
      issue(
        "invalid-policies",
        "VELLAR_X402_POLICIES",
        "Policies require VELLAR_X402_WALLET to be configured.",
      ),
    );
  }

  for (const policy of policies ?? []) {
    if (!StrKey.isValidContract(policy)) {
      issues.push(
        issue(
          "invalid-policies",
          "VELLAR_X402_POLICIES",
          "Every policy must be a valid Soroban contract ID.",
        ),
      );
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}
