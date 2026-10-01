// Reference implementation for #436: Revoked passkey detection in resumeKitConnection
// This demonstrates on-chain verification that a keyId is still a valid signer.

/**
 * Error thrown when a passkey is no longer a signer on the wallet contract.
 * Requires the user to disconnect and reconnect with a valid passkey.
 */
export class PasskeyRevokedError extends Error {
  constructor(
    public readonly walletAddress: string,
    public readonly keyId: string,
  ) {
    super(
      `The passkey ${keyId} is no longer a signer on wallet ${walletAddress}. ` +
        `It was revoked after this session was created. Disconnect and reconnect to re-enroll.`,
    );
    this.name = "PasskeyRevokedError";
  }
}

/**
 * Error thrown when signer verification fails due to network issues.
 * This is retryable, unlike PasskeyRevokedError.
 */
export class SignerVerificationFailedError extends Error {
  constructor(
    public readonly walletAddress: string,
    public readonly cause: unknown,
  ) {
    super(
      `Could not verify signer status for wallet ${walletAddress}: ${
        cause instanceof Error ? cause.message : String(cause)
      }. Retry if this was a transient network error.`,
    );
    this.name = "SignerVerificationFailedError";
  }
}

/**
 * Mock RPC client for testing. In real implementation, this would use
 * @stellar/stellar-sdk's SorobanRpc.Server.
 */
export interface RpcClient {
  /**
   * Simulate a contract call to get_signers().
   * Returns list of active signers on the wallet.
   */
  getSigners(walletAddress: string): Promise<Array<{ keyId: string }>>;
}

/**
 * Options for signer verification.
 */
export interface VerifySignerOptions {
  /** RPC client (or URL to create one) */
  rpc: RpcClient | string;
  /** Skip verification for testing */
  skipVerification?: boolean;
}

/**
 * Verify that a keyId is still an active signer on the wallet contract.
 * 
 * This is a READ-ONLY operation that does NOT trigger a WebAuthn ceremony.
 * It uses RPC simulation to check the wallet's get_signers() method.
 * 
 * @throws {PasskeyRevokedError} If keyId is not a signer (requires reconnect)
 * @throws {SignerVerificationFailedError} If RPC call fails (retryable)
 */
export async function verifyKeyStillSigner(
  walletAddress: string,
  keyId: string,
  options: VerifySignerOptions,
): Promise<boolean> {
  if (options.skipVerification) {
    return true;
  }

  const rpc = typeof options.rpc === "string" ? createRpcClient(options.rpc) : options.rpc;

  try {
    // Call wallet.get_signers() via RPC simulation
    const signers = await rpc.getSigners(walletAddress);

    // Check if keyId is in the active signers list
    return signers.some((s) => s.keyId === keyId);
  } catch (err) {
    // Network errors, RPC failures, contract not found
    throw new SignerVerificationFailedError(walletAddress, err);
  }
}

/**
 * Enhanced resumeKitConnection that verifies the key before connecting.
 * 
 * This is the pattern that should be integrated into src/passkeykit-connector.ts.
 */
export async function resumeKitConnectionWithVerification(
  kit: { connectWallet: (opts: { keyId: string }) => Promise<void>; wallet?: unknown },
  keyId: string,
  walletAddress: string,
  options: VerifySignerOptions,
): Promise<void> {
  // Already connected - no-op
  if (kit.wallet) return;

  // Verify keyId is still a signer BEFORE connecting
  // This does NOT trigger WebAuthn - it's a read-only RPC call
  const isValid = await verifyKeyStillSigner(walletAddress, keyId, options);

  if (!isValid) {
    throw new PasskeyRevokedError(walletAddress, keyId);
  }

  // Key is valid - safe to connect
  await kit.connectWallet({ keyId });
}

/**
 * Create a mock RPC client from a URL.
 * Real implementation would use SorobanRpc.Server.
 */
function createRpcClient(url: string): RpcClient {
  return {
    async getSigners(walletAddress: string) {
      // Mock implementation - real version would use stellar-sdk
      throw new Error(`Mock RPC client cannot actually call ${url}`);
    },
  };
}
