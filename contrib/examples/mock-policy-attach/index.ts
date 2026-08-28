import type { PolicyAttachRuntime } from "../../../src/policy-facade";

/**
 * Mock PolicyAttachRuntime for unit tests.
 *
 * - attachPolicy returns a fixed sample transaction hash.
 * - resume is a no-op documented in the README.
 */
const FIXED_HASH = "aaa111bbb222ccc333ddd444eee555fff666777888";

export function createMockPolicyAttachRuntime(opts?: { hash?: string }): PolicyAttachRuntime {
  const hash = opts?.hash ?? FIXED_HASH;

  return {
    resume() {
      // no-op: mock does not prompt or manipulate passkey state.
      return Promise.resolve();
    },
    async attachPolicy() {
      return { hash };
    },
  };
}