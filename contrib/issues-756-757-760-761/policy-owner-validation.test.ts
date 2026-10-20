import { describe, expect, it, vi } from "vitest";
import {
  assertNoDuplicateOwners,
  createPolicyFacadeWithOwnerValidation,
  DuplicateOwnerError,
} from "./policy-owner-validation.js";

// Two distinct valid Stellar G... public keys used across tests.
const OWNER_A = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AKSKPD3FN";
const OWNER_B = "GDBXHJ53TGKDOP2O3Q5TKXPMGTHA2OPT5BCBYFCRF4PE3EODQLWYPUIQ";
const WALLET  = "CWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDE";

const baseDefinition = {
  version: "1",
  type: "multisig",
  owners: [OWNER_A, OWNER_B],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function facade(fetchMock: typeof fetch) {
  return createPolicyFacadeWithOwnerValidation({
    apiUrl: "https://api.test",
    network: "testnet",
    requireSession: () => ({ accountId: WALLET, keyId: "key-1" }),
    fetch: fetchMock,
  });
}

// ── assertNoDuplicateOwners unit tests ────────────────────────────────────────

describe("assertNoDuplicateOwners", () => {
  it("does not throw for a list of unique owners", () => {
    expect(() => assertNoDuplicateOwners([OWNER_A, OWNER_B])).not.toThrow();
  });

  it("does not throw for an empty owners array", () => {
    expect(() => assertNoDuplicateOwners([])).not.toThrow();
  });

  it("does not throw for a single owner", () => {
    expect(() => assertNoDuplicateOwners([OWNER_A])).not.toThrow();
  });

  it("throws DuplicateOwnerError when the same address appears twice", () => {
    expect(() => assertNoDuplicateOwners([OWNER_A, OWNER_B, OWNER_A])).toThrow(
      DuplicateOwnerError,
    );
  });

  it("throws DuplicateOwnerError when the owners array contains only duplicates", () => {
    expect(() => assertNoDuplicateOwners([OWNER_A, OWNER_A])).toThrow(DuplicateOwnerError);
  });

  it("error message names the offending address", () => {
    let err: unknown;
    try {
      assertNoDuplicateOwners([OWNER_A, OWNER_B, OWNER_A]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DuplicateOwnerError);
    expect((err as DuplicateOwnerError).message).toContain(OWNER_A);
    expect((err as DuplicateOwnerError).duplicateAddress).toBe(OWNER_A);
  });

  it("treats addresses differing only by case as distinct (Stellar base32 is case-sensitive)", () => {
    // Lower-cased variant is a different string — no error expected.
    expect(() => assertNoDuplicateOwners([OWNER_A, OWNER_A.toLowerCase()])).not.toThrow();
  });
});

// ── createPolicyFacadeWithOwnerValidation integration tests ───────────────────

describe("createPolicyFacadeWithOwnerValidation — generate()", () => {
  it("rejects a PolicyDefinition with a duplicate owner before any network call", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const p = facade(fetchMock);

    await expect(
      p.generate({ ...baseDefinition, owners: [OWNER_A, OWNER_B, OWNER_A] }),
    ).rejects.toBeInstanceOf(DuplicateOwnerError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when both owners are the same address", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const p = facade(fetchMock);

    await expect(
      p.generate({ ...baseDefinition, owners: [OWNER_A, OWNER_A] }),
    ).rejects.toBeInstanceOf(DuplicateOwnerError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid definition to the network when owners are unique", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "generated" } }),
    );
    const p = facade(fetchMock);

    await p.generate({ ...baseDefinition, owners: [OWNER_A, OWNER_B] });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows a single-owner definition (no duplicate possible)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "generated" } }),
    );
    const p = facade(fetchMock);

    await p.generate({ ...baseDefinition, owners: [OWNER_A] });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
