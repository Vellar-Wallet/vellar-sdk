// Example: a deterministic mock passkey registration + authentication
// ceremony, for wiring into a CI test suite with no real browser or
// WebAuthn support. The same seed always produces the same mock
// credential, so tests stay reproducible.
//
// Run with: npx tsx mock-passkey-ceremony.ts

export interface MockCredential {
  credentialId: string;
  publicKey: string;
}

// A small seeded PRNG (mulberry32) so credential generation is
// deterministic from a string seed without pulling in a crypto dependency
// — this is a test double, not a real key generator.
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHex(rand: () => number, byteLength: number): string {
  let out = "";
  for (let i = 0; i < byteLength; i++) {
    out += Math.floor(rand() * 256).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Deterministically derives a mock WebAuthn-shaped credential from `seed`:
 * the same seed always produces the same credentialId and publicKey across
 * calls (and across process restarts — there's no hidden global state).
 */
export function generateMockCredential(seed: string): MockCredential {
  const rand = mulberry32(hashSeed(seed));
  return {
    credentialId: randomHex(rand, 16),
    publicKey: randomHex(rand, 32),
  };
}

export interface RegisterResult {
  credential: MockCredential;
  registeredAt: string;
}

export interface AuthenticateResult {
  credential: MockCredential;
  authenticatedAt: string;
}

/** In-memory "authenticator": remembers registered credentials by id, the
 * same way a real platform authenticator would, so authenticate() can only
 * succeed for a credential this instance actually registered. */
export function createMockAuthenticator() {
  const registered = new Map<string, MockCredential>();

  return {
    /** Registration ceremony: derives a credential from `seed` and stores it. */
    register(seed: string): RegisterResult {
      const credential = generateMockCredential(seed);
      registered.set(credential.credentialId, credential);
      return { credential, registeredAt: new Date().toISOString() };
    },

    /** Authentication ceremony: looks up a previously registered credential
     * by id. Throws for an id this authenticator never registered — a real
     * authenticator refuses an unknown credential too. */
    authenticate(credentialId: string): AuthenticateResult {
      const credential = registered.get(credentialId);
      if (!credential) {
        throw new Error(`No credential registered with id "${credentialId}"`);
      }
      return { credential, authenticatedAt: new Date().toISOString() };
    },
  };
}

function main() {
  console.log("Determinism check: generateMockCredential('alice-device') called twice...");
  const first = generateMockCredential("alice-device");
  const second = generateMockCredential("alice-device");
  console.log(`  call 1: ${first.credentialId}`);
  console.log(`  call 2: ${second.credentialId}`);
  console.log(`  same credentialId both times: ${first.credentialId === second.credentialId}`);

  console.log("\nFull register-then-authenticate sequence:");
  const authenticator = createMockAuthenticator();

  console.log("  Step 1: register with seed 'alice-device'");
  const { credential } = authenticator.register("alice-device");
  console.log(`    registered credentialId = ${credential.credentialId}`);

  console.log("  Step 2: authenticate with that credentialId");
  const authResult = authenticator.authenticate(credential.credentialId);
  console.log(`    authenticated at ${authResult.authenticatedAt}, publicKey = ${authResult.credential.publicKey}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
