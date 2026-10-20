// Duplicate-owner guard for PolicyDefinition (#756 #757 #760 #761).
//
// WHY THIS EXISTS: PolicyDefinition.owners is a string array that forms a
// multisig owner set. A duplicate address in that array is a meaningless or
// exploitable configuration — threshold-based approval could be satisfied by
// a single key signing twice. The core generate() path currently forwards the
// definition to the backend without checking uniqueness client-side.
//
// This module adds the guard as a standalone wrapper that contrib PRs may
// apply without touching src/ directly. See "Integration into Core" below.
//
// Integration into Core:
//   1. Copy DuplicateOwnerError into src/policy-facade.ts beside
//      PolicyNotDeployableError.
//   2. In createPolicyFacade's generate() method, add the same Set-based
//      uniqueness check before calling client.generate(definition).
//   3. Export DuplicateOwnerError from src/index.ts.
//   4. Add the JSDoc comment on PolicyDefinition.owners in src/types.ts.
//   5. Delete this contrib file once core carries the fix.

import type { PolicyDefinition } from "../../src/types.js";
import { createPolicyFacade, type PolicyFacadeDeps } from "../../src/policy-facade.js";

/** Thrown by {@link createPolicyFacadeWithOwnerValidation} when
 * `PolicyDefinition.owners` contains the same address more than once. */
export class DuplicateOwnerError extends Error {
  readonly duplicateAddress: string;
  constructor(address: string) {
    super(
      `PolicyDefinition.owners contains a duplicate address: ${address}. ` +
        `Each owner must appear exactly once.`,
    );
    this.name = "DuplicateOwnerError";
    this.duplicateAddress = address;
  }
}

/**
 * Validates that every address in `owners` is unique.
 * Stellar addresses are case-sensitive in their base32 encoding —
 * `"GABC…"` and `"gabc…"` are treated as distinct strings here, matching
 * the network's own encoding rules.
 *
 * @throws {DuplicateOwnerError} on the first repeated address found.
 */
export function assertNoDuplicateOwners(owners: string[]): void {
  const seen = new Set<string>();
  for (const owner of owners) {
    if (seen.has(owner)) throw new DuplicateOwnerError(owner);
    seen.add(owner);
  }
}

/**
 * Drop-in wrapper around `createPolicyFacade` that rejects a
 * `PolicyDefinition` containing duplicate owner addresses before any
 * network call or passkey prompt.
 *
 * Usage is identical to `createPolicyFacade` — swap the import only:
 *
 * ```ts
 * import { createPolicyFacadeWithOwnerValidation } from
 *   "./contrib/issues-756-757-760-761/policy-owner-validation.js";
 * ```
 */
export function createPolicyFacadeWithOwnerValidation(deps: PolicyFacadeDeps) {
  const inner = createPolicyFacade(deps);
  return {
    ...inner,
    generate(definition: PolicyDefinition) {
      assertNoDuplicateOwners(definition.owners);
      return inner.generate(definition);
    },
  };
}
