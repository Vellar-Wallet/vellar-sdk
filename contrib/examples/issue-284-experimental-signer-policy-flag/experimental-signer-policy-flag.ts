// Self-contained reference for issue #284: a feature-flag pattern for gating
// experimental x402 signer policy behavior, so early adopters can opt in
// without a hard breaking change for everyone else.
//
// The real vellar-sdk signers (src/x402-signer.ts) accept a `capabilities`
// rule set whose `resourceType`/`action` fields each allow a `"*"` wildcard.
// A wildcard left in place after copy-pasting an example silently widens what
// a session key will sign. Tightening that by default would break every
// existing config that relies on wildcards — so the change is gated behind an
// experimental flag instead. This is a standalone, dependency-free
// demonstration of that flag pattern.
//
// The pattern itself is the point, and it generalizes to any experimental
// signer policy change:
//
//   1. The new behavior lives behind a named `experimental*` boolean.
//   2. Omitted / `false` reproduces today's behavior EXACTLY.
//   3. `true` opts into the stricter (or simply different) behavior.
//   4. Validation happens at construction, not at sign time, so a bad
//      config fails loudly before it can sign anything.
//
// Run with: npx tsx experimental-signer-policy-flag.ts

/** One resource+action a signer is permitted to authorize. `"*"` matches any
 * value for that field. */
export interface CapabilityRule {
  /** The contract this rule applies to (a SEP-41 token), or `"*"` for any. */
  resourceType: string;
  /** The Soroban function name this rule permits, or `"*"` for any. */
  action: string;
}

/** Config for the mock signer, mirroring the shape of the real
 * `SessionKeySignerConfig` but carrying only what this example needs. */
export interface MockSignerConfig {
  /** The smart-account C-address that pays. */
  address: string;
  /** Client-side capability scoping. Omit for no scoping. */
  capabilities?: readonly CapabilityRule[];
  /**
   * EXPERIMENTAL — opt in to stricter capability-rule validation: any rule
   * using a `"*"` wildcard is rejected at construction, requiring every rule
   * to be fully explicit.
   *
   * Default (`false`/omitted): unchanged — wildcard rules are accepted, same
   * as every signer built before this flag existed.
   */
  experimentalStrictWildcardCapabilities?: boolean;
}

/** Thrown when a capability rule is malformed, or when a wildcard rule is
 * used while the experimental strict flag is enabled. */
export class InvalidCapabilityRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCapabilityRuleError";
  }
}

/** Thrown by the signer when a requested invocation matches no rule. */
export class CapabilityDeniedError extends Error {
  constructor(
    readonly request: { resourceType: string; action: string },
    readonly rules: readonly CapabilityRule[],
  ) {
    super(
      `capability check denied ${request.action} on ${request.resourceType}: ` +
        `no configured rule permits it (${rules.length} rule(s) configured).`,
    );
    this.name = "CapabilityDeniedError";
  }
}

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
// Soroban symbols: ASCII alphanumeric + underscore, <= 32 chars.
const SOROBAN_SYMBOL = /^[A-Za-z0-9_]{1,32}$/;

/**
 * Validate a capability rule set at construction time.
 *
 * `strictWildcards` is the experimental gate: when `true`, any rule using
 * `"*"` for `resourceType` or `action` is additionally rejected. When
 * `false` (the default), wildcard rules are perfectly valid — this is what
 * keeps the flag non-breaking for existing consumers.
 */
export function assertValidCapabilityRules(
  rules: readonly CapabilityRule[],
  strictWildcards = false,
): void {
  for (const rule of rules) {
    if (rule.resourceType !== "*" && !CONTRACT_ID.test(rule.resourceType)) {
      throw new InvalidCapabilityRuleError(
        `capability rule resourceType must be a contract id (C…) or "*": got ${JSON.stringify(rule.resourceType)}`,
      );
    }
    if (rule.action !== "*" && !SOROBAN_SYMBOL.test(rule.action)) {
      throw new InvalidCapabilityRuleError(
        `capability rule action must be a Soroban function-name symbol or "*": got ${JSON.stringify(rule.action)}`,
      );
    }
    if (strictWildcards && (rule.resourceType === "*" || rule.action === "*")) {
      throw new InvalidCapabilityRuleError(
        `capability rule uses a wildcard ("*") but experimentalStrictWildcardCapabilities ` +
          `is enabled, which requires every rule to name an explicit resourceType ` +
          `and action: got ${JSON.stringify(rule)}`,
      );
    }
  }
}

/**
 * Does any rule permit `request`? An EMPTY rule set means "no scoping
 * configured" and permits everything — the backward-compatible default for a
 * signer that never opted into capability scoping at all.
 */
export function evaluateCapability(
  rules: readonly CapabilityRule[],
  request: { resourceType: string; action: string },
): boolean {
  if (rules.length === 0) return true;
  return rules.some(
    (rule) =>
      (rule.resourceType === "*" || rule.resourceType === request.resourceType) &&
      (rule.action === "*" || rule.action === request.action),
  );
}

export interface MockSigner {
  readonly address: string;
  /** Mock "sign": asserts the invocation is permitted, then returns a
   * placeholder signature. The real signer would build the auth-entry
   * signature map here. */
  signInvocation(request: { resourceType: string; action: string }): string;
}

/**
 * Build a mock signer, applying the experimental flag at CONSTRUCTION time.
 *
 * This is the crux of the pattern: the flag changes whether construction
 * succeeds, not whether a later signature is produced. A config that would
 * be rejected under the flag fails immediately and visibly, rather than
 * behaving subtly differently at sign time.
 */
export function createMockSigner(config: MockSignerConfig): MockSigner {
  const capabilities = config.capabilities ?? [];
  assertValidCapabilityRules(
    capabilities,
    config.experimentalStrictWildcardCapabilities ?? false,
  );

  return {
    address: config.address,
    signInvocation(request) {
      if (!evaluateCapability(capabilities, request)) {
        throw new CapabilityDeniedError(request, capabilities);
      }
      return `signed:${request.action}@${request.resourceType}`;
    },
  };
}

function main() {
  const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
  const USDC = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

  // A config that leans on a wildcard — the kind left behind after copying
  // an example.
  const wildcardConfig: MockSignerConfig = {
    address: WALLET,
    capabilities: [{ resourceType: USDC, action: "*" }],
  };

  // 1. UNFLAGGED (today's behavior): the wildcard is accepted.
  const lenient = createMockSigner(wildcardConfig);
  console.log("unflagged, wildcard rule    :", lenient.signInvocation({ resourceType: USDC, action: "burn" }));

  // 2. FLAGGED: the very same config is now rejected at construction.
  try {
    createMockSigner({ ...wildcardConfig, experimentalStrictWildcardCapabilities: true });
    console.log("flagged, wildcard rule      : UNEXPECTED — should have thrown");
  } catch (err) {
    console.log("flagged, wildcard rule      : rejected —", (err as Error).name);
  }

  // 3. FLAGGED with fully explicit rules: unaffected, signs as normal.
  const strict = createMockSigner({
    address: WALLET,
    capabilities: [{ resourceType: USDC, action: "transfer" }],
    experimentalStrictWildcardCapabilities: true,
  });
  console.log("flagged, explicit rules     :", strict.signInvocation({ resourceType: USDC, action: "transfer" }));

  // 4. The capability check itself still applies regardless of the flag.
  try {
    strict.signInvocation({ resourceType: USDC, action: "burn" });
  } catch (err) {
    console.log("flagged, out-of-scope action: denied —", (err as Error).name);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
