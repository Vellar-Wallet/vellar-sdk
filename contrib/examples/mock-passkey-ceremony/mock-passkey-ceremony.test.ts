import { describe, expect, it } from "vitest";
import { createMockAuthenticator, generateMockCredential } from "./mock-passkey-ceremony";

describe("generateMockCredential", () => {
  it("produces the same credential for the same seed across two calls", () => {
    const first = generateMockCredential("alice-device");
    const second = generateMockCredential("alice-device");
    expect(first).toEqual(second);
  });

  it("produces different credentials for different seeds", () => {
    const alice = generateMockCredential("alice-device");
    const bob = generateMockCredential("bob-device");
    expect(alice.credentialId).not.toBe(bob.credentialId);
  });

  it("returns hex strings of the expected length", () => {
    const credential = generateMockCredential("seed");
    expect(credential.credentialId).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(credential.publicKey).toMatch(/^[0-9a-f]{64}$/); // 32 bytes
  });
});

describe("createMockAuthenticator", () => {
  it("authenticates a credential it registered", () => {
    const authenticator = createMockAuthenticator();
    const { credential } = authenticator.register("alice-device");

    const result = authenticator.authenticate(credential.credentialId);
    expect(result.credential).toEqual(credential);
  });

  it("throws for a credential id it never registered", () => {
    const authenticator = createMockAuthenticator();
    expect(() => authenticator.authenticate("unknown-id")).toThrow(/No credential registered/);
  });

  it("keeps registrations independent across separate authenticator instances", () => {
    const a = createMockAuthenticator();
    const b = createMockAuthenticator();
    const { credential } = a.register("alice-device");

    expect(() => b.authenticate(credential.credentialId)).toThrow(/No credential registered/);
  });

  it("supports registering and authenticating multiple credentials", () => {
    const authenticator = createMockAuthenticator();
    const alice = authenticator.register("alice-device").credential;
    const bob = authenticator.register("bob-device").credential;

    expect(authenticator.authenticate(alice.credentialId).credential).toEqual(alice);
    expect(authenticator.authenticate(bob.credentialId).credential).toEqual(bob);
  });
});
