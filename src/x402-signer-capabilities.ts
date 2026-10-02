// Scoped capability checks for x402 signers (#224).
//
// WHAT THIS DOES AND DOES NOT COVER — read before trusting it (same discipline
// as x402-auth-entry.ts and x402-untrusted.ts).
//
//   Today an x402 signer (createSessionKeySigner / createPasskeyX402Signer)
//   signs ANY auth entry addressed to its wallet, once x402-client.ts has
//   cleared it: the client already asserts the invocation is EXACTLY the
//   intended payment (x402-auth-entry.ts, "what we are about to sign"), but
//   nothing on the SIGNER's own config says what that key is allowed to sign
//   at all. Two callers sharing a session key (e.g. a multi-tenant agent
//   process) or a signer reused across unrelated call sites have no local
//   guard narrower than "everything this wallet can do".
//
//   This module adds that narrower guard: a CapabilityRule set, keyed by
//   resource type (the SEP-41 token / contract) and action (the function
//   name), that the signer checks BEFORE it signs. It runs entirely inside
//   this process, in addition to (never instead of) the on-chain
//   SignerLimits + Policy co-signer mechanism in x402-signer.ts, which is the
//   only check a compromised or bypassed SDK cannot get around.
//
//   So: "the signer refuses to sign outside its configured capabilities" is
//   true and enforced HERE. "The wallet cannot be made to pay outside these
//   capabilities" is NOT covered by this module alone — that guarantee, if
//   you need it to hold even against a compromised host process, still
//   requires an on-chain SignerLimits / Policy contract restricting the same
//   key (see the "Agent keys" section of the README). Client-side capability
//   checks are a defense-in-depth narrowing, not a replacement for the chain.

/** One resource+action a signer is permitted to authorize. `"*"` matches any
 * value for that field — e.g. `{ resourceType: token, action: "*" }` permits
 * every action against that token. */
export interface CapabilityRule {
  /** The contract this rule applies to (a SEP-41 token, i.e. the x402 asset),
   * or `"*"` for any contract. */
  resourceType: string;
  /** The Soroban function name this rule permits (e.g. `"transfer"`), or
   * `"*"` for any function. */
  action: string;
}

/** What the signer is about to be asked to authorize, extracted from the
 * decoded auth entry's root invocation. */
export interface CapabilityRequest {
  resourceType: string;
  action: string;
}

/** Thrown by a signer when the requested invocation matches no capability rule. */
export class CapabilityDeniedError extends Error {
  constructor(
    readonly request: CapabilityRequest,
    readonly rules: readonly CapabilityRule[],
  ) {
    super(
      `x402 signer capability check denied ${request.action} on ${request.resourceType}: ` +
        `no configured capability rule permits it (${rules.length} rule(s) configured). ` +
        `This is a client-side guard on what this signer will sign — it is independent of, ` +
        `and does not substitute for, an on-chain SignerLimits/Policy restriction on the key.`,
    );
    this.name = "CapabilityDeniedError";
  }
}

/** A capability rule named a resource type or action that isn't a plausible
 * contract id / Soroban symbol. Caught at signer construction, not at sign
 * time, so a typo'd rule fails loudly before it can either wrongly deny or
 * (worse) wrongly admit. */
export class InvalidCapabilityRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCapabilityRuleError";
  }
}

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
// Soroban symbols: ASCII alphanumeric + underscore, <= 32 chars, matching the
// function names this SDK actually emits (e.g. "transfer").
const SOROBAN_SYMBOL = /^[A-Za-z0-9_]{1,32}$/;

/** Validate a capability rule set at construction time. Throws on the first
 * malformed rule; an empty array is valid (see {@link evaluateCapability}). */
export function assertValidCapabilityRules(rules: readonly CapabilityRule[]): void {
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
  }
}

/**
 * Does any rule in `rules` permit `request`? A rule permits a request when its
 * `resourceType` is `"*"` or equals the request's, AND its `action` is `"*"`
 * or equals the request's.
 *
 * An EMPTY rule set means "no capability scoping configured" and permits
 * everything — this is the default, backward-compatible behaviour for a
 * signer that never opted into capability scoping. Passing a non-empty rule
 * set is what actually turns the check on; passing rules and having every
 * request denied by default (a "deny unless listed" empty-set reading) would
 * silently break every existing signer that doesn't pass `capabilities` at
 * all, so scoping is opt-in per signer instance, not opt-in per action.
 */
export function evaluateCapability(
  rules: readonly CapabilityRule[],
  request: CapabilityRequest,
): boolean {
  if (rules.length === 0) return true;
  return rules.some(
    (rule) =>
      (rule.resourceType === "*" || rule.resourceType === request.resourceType) &&
      (rule.action === "*" || rule.action === request.action),
  );
}

/** Enforce the rule set, throwing {@link CapabilityDeniedError} when denied. */
export function assertCapability(
  rules: readonly CapabilityRule[],
  request: CapabilityRequest,
): void {
  if (!evaluateCapability(rules, request)) {
    throw new CapabilityDeniedError(request, rules);
  }
}
