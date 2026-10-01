// The live-testnet guard.
//
// WHY THIS IS CODE AND NOT A README WARNING: this suite pays a real,
// already publicly-cataloged demo resource against the shared hosted
// facilitator (see packages/mcp-x402-payer/test/integration/local-only.ts for
// why the OTHER integration suite refuses that same endpoint — this one
// exists precisely to cover it, since nothing else in the repo pays a real
// resource end to end). The one failure mode that must never happen is the
// same request settling on a pubnet network: that would spend real funds
// instead of testnet XLM. The check runs before a payment is trusted as
// complete, and it throws.

export class NonTestnetNetworkError extends Error {
  constructor(network: string) {
    super(
      `Expected network "stellar:testnet" but got ${JSON.stringify(network)}. This ` +
        "integration test pays a real resource and refuses to settle on anything other than " +
        "testnet — a pubnet network here would spend real funds.",
    );
    this.name = "NonTestnetNetworkError";
  }
}

/** Throw unless `network` is exactly the testnet CAIP-2 id. */
export function assertTestnetNetwork(network: string): void {
  if (network !== "stellar:testnet") {
    throw new NonTestnetNetworkError(network);
  }
}

export interface LiveIntegrationEnv {
  sellerUrl: string;
  secret: string;
  asset: string;
}

/** The documented public demo resource — see reference/proofs.md and facilitator.md. */
const DEFAULT_SELLER_URL = "https://vellar-seller-demo.onrender.com/quote";

/**
 * Read the live integration environment, or return null when it is not
 * configured (so the suite can skip rather than fail on a machine with no
 * funded testnet key).
 *
 * A partially-configured environment is an ERROR, not a skip — same reasoning
 * as local-only.ts: a half-set environment is how a test silently stops
 * covering anything.
 */
export function readLiveIntegrationEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveIntegrationEnv | null {
  const secret = env.VELLAR_LIVE_X402_SECRET?.trim();
  const asset = env.VELLAR_LIVE_X402_TEST_ASSET?.trim();
  const sellerUrl = env.VELLAR_LIVE_X402_SELLER_URL?.trim();

  const set = [secret, asset].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 2) {
    throw new Error(
      "Live integration environment is only partially set. Provide BOTH of " +
        "VELLAR_LIVE_X402_SECRET and VELLAR_LIVE_X402_TEST_ASSET, or neither.",
    );
  }

  return {
    sellerUrl: sellerUrl || DEFAULT_SELLER_URL,
    secret: secret!,
    asset: asset!,
  };
}
