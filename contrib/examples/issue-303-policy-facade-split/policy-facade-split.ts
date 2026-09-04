/**
 * The composed policy facade — reads and writes recombined into the same
 * surface `vellar.policies` exposes today.
 *
 * Contributed for issue #303. The requirement that shaped this file is
 * "ensure existing tests pass unchanged against the refactored structure":
 * the split must be invisible from outside. `createSplitPolicyFacade` returns
 * an object with exactly the members `createPolicyFacade` returns, with the
 * same behaviour, so no caller and no existing test has to change.
 *
 * What the split buys, given the surface is identical:
 *
 *   - "Can this mutate anything?" is answered by which file an operation is
 *     in, not by reading its body.
 *   - The read module can be constructed and tested without an attach runtime,
 *     because reads never prompt for a passkey.
 *   - A new operation has to be classified to be added at all, so the
 *     side-effect boundary can't erode quietly.
 *
 * The composition itself stays deliberately dumb — spread both halves, expose
 * the client. No logic lives here, so there is nothing to keep in sync with
 * the two modules that do the work.
 */

import { createPolicyReads, type PolicyReadOperations } from "./policy-reads";
import { createPolicyWrites, type PolicyWriteOperations } from "./policy-writes";
import type {
  PolicyAttachRuntimeLike,
  PolicyClientLike,
  RequireSession,
} from "./policy-facade-types";

export { PolicyNotDeployableError } from "./policy-writes";
export { createPolicyReads, type PolicyReadOperations } from "./policy-reads";
export { createPolicyWrites, type PolicyWriteOperations } from "./policy-writes";

/**
 * The full facade: every read, every write, plus the lower-level client.
 *
 * Structurally identical to `PolicyFacade` in `src/policy-facade.ts`, with the
 * read/write provenance of each member now visible in the type.
 */
export interface SplitPolicyFacade extends PolicyReadOperations, PolicyWriteOperations {
  /** The lower-level HTTP client, for custom flows. */
  readonly client: PolicyClientLike;
}

export interface SplitPolicyFacadeDeps {
  client: PolicyClientLike;
  requireSession: RequireSession;
  attach?: PolicyAttachRuntimeLike;
}

/**
 * Compose the two halves into the facade the wallet handle exposes.
 *
 * Takes an already-constructed client rather than an `apiUrl`, so both halves
 * share one client instance and the example stays testable without a network.
 * In `src/`, this is where `createPolicyClient({ apiUrl, network, fetch })`
 * would be called, exactly as `createPolicyFacade` does today.
 */
export function createSplitPolicyFacade(deps: SplitPolicyFacadeDeps): SplitPolicyFacade {
  const { client, requireSession, attach } = deps;

  const reads = createPolicyReads({ client, requireSession });
  const writes = createPolicyWrites({ client, requireSession, attach });

  return { client, ...reads, ...writes };
}
