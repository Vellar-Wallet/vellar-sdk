// Issue #664 — the wallet session expires between the signer starting and the
// passkey actually signing.
//
// The session side is the REAL src/session.ts store. The signer is a
// passkey-shaped double whose "prompt" stays open until the test resolves it,
// so the race window can be hit deterministically. (The real
// createPasskeyX402Signer cannot be imported on dev right now: a bad merge left
// src/x402-signer.ts with a syntax error — see this folder's README. The guard
// only depends on the SmartAccountX402Signer interface, which is what both real
// signers implement.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorageAdapter, createSessionStore, type SessionStore } from "../../src/session.js";
import type { WalletSession } from "../../src/types.js";
import { createX402Client } from "../../src/x402-client.js";
import type { SmartAccountX402Signer } from "../../src/x402-types.js";
import {
  SessionInvalidatedDuringSigningError,
  sessionFromStore,
  withSessionGuard,
} from "./x402-signer-session-guard.js";
import {
  RPC_URL,
  SIM_SOURCE,
  WALLET,
  mockSorobanRpcFromRecording,
  recordedRequirements,
} from "./test-helpers.js";

const SIGN_OPTS = { networkPassphrase: "Test SDF Network ; September 2015", expirationLedger: 100 };

function session(over: Partial<WalletSession> = {}): WalletSession {
  return {
    accountId: WALLET,
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-10-19T10:00:00.000Z",
    lastActiveAt: "2026-10-19T10:00:00.000Z",
    ...over,
  };
}

/** A passkey-like signer: each call opens a "prompt" the test completes later. */
function ceremonySigner() {
  const started: Array<() => void> = [];
  let signedCount = 0;
  const signer: SmartAccountX402Signer = {
    address: WALLET,
    signAuthEntry: vi.fn(
      (entryXdr: string) =>
        new Promise<string>((resolve) => {
          started.push(() => {
            signedCount++;
            resolve(entryXdr);
          });
        }),
    ),
  };
  return {
    signer,
    /** The user approves the open prompt (the authenticator produces a signature). */
    approve: () => started.shift()!(),
    get promptsOpened() {
      return (signer.signAuthEntry as ReturnType<typeof vi.fn>).mock.calls.length;
    },
    get signaturesProduced() {
      return signedCount;
    },
  };
}

/** Let the guard's awaited call reach the signer before acting. */
const tick = () => new Promise((r) => setTimeout(r, 0));

let store: SessionStore;

beforeEach(async () => {
  store = createSessionStore(createMemoryStorageAdapter());
  await store.getState().start(session());
});

afterEach(() => {
  store.getState().dispose();
  vi.restoreAllMocks();
});

describe("withSessionGuard — the race between signing start and completion", () => {
  it("happy path: session stays valid → the signature is returned", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const pending = guarded.signAuthEntry("ENTRY", SIGN_OPTS);
    await tick();
    c.approve();

    await expect(pending).resolves.toBe("ENTRY");
  });

  it("session ends while the prompt is open → signature discarded, named error", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const pending = guarded.signAuthEntry("ENTRY", SIGN_OPTS);
    await tick();
    await store.getState().end(); // e.g. the user signs out in another tab
    c.approve(); // the authenticator still completes

    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionInvalidatedDuringSigningError);
    expect((err as SessionInvalidatedDuringSigningError).phase).toBe("during-signing");
    // A signature was produced by the authenticator — and never handed back.
    expect(c.signaturesProduced).toBe(1);
  });

  it("session replaced mid-prompt (sign out and back in) → discarded", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const pending = guarded.signAuthEntry("ENTRY", SIGN_OPTS);
    await tick();
    await store.getState().end();
    await store.getState().start(session({ createdAt: "2026-10-19T10:05:00.000Z" }));
    c.approve();

    await expect(pending).rejects.toThrow(/replaced by a new one/);
  });

  it("session switched to another wallet mid-prompt → discarded", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const pending = guarded.signAuthEntry("ENTRY", SIGN_OPTS);
    await tick();
    await store.getState().start(session({ accountId: "COTHERWALLET" }));
    c.approve();

    await expect(pending).rejects.toBeInstanceOf(SessionInvalidatedDuringSigningError);
  });

  it("session goes idle past maxIdleMs while the prompt is open → discarded", async () => {
    let clock = new Date("2026-10-19T10:00:30.000Z");
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, {
      getSession: sessionFromStore(store),
      maxIdleMs: 60_000,
      now: () => clock,
    });

    const pending = guarded.signAuthEntry("ENTRY", SIGN_OPTS);
    await tick();
    clock = new Date("2026-10-19T10:01:30.000Z"); // 90s idle by the time it returns
    c.approve();

    await expect(pending).rejects.toThrow(/expired \(idle\)/);
  });

  it("no session before signing → refused up front, the prompt never opens", async () => {
    await store.getState().end();
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const err = await guarded.signAuthEntry("ENTRY", SIGN_OPTS).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SessionInvalidatedDuringSigningError);
    expect((err as SessionInvalidatedDuringSigningError).phase).toBe("before-signing");
    expect(c.promptsOpened).toBe(0);
  });

  it("a session for a different wallet → refused up front", async () => {
    await store.getState().start(session({ accountId: "COTHERWALLET" }));
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    await expect(guarded.signAuthEntry("ENTRY", SIGN_OPTS)).rejects.toThrow(/COTHERWALLET/);
    expect(c.promptsOpened).toBe(0);
  });

  it("the underlying signer's own error (user cancels the prompt) passes through unchanged", async () => {
    const cancelled = new Error("NotAllowedError: the user cancelled");
    const guarded = withSessionGuard(
      { address: WALLET, signAuthEntry: async () => Promise.reject(cancelled) },
      { getSession: sessionFromStore(store) },
    );
    await expect(guarded.signAuthEntry("ENTRY", SIGN_OPTS)).rejects.toBe(cancelled);
  });
});

describe("end to end through the real createX402Client", () => {
  beforeEach(() => {
    mockSorobanRpcFromRecording();
  });

  function client(signer: SmartAccountX402Signer) {
    return createX402Client({
      signer,
      rpcUrl: RPC_URL,
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
    });
  }

  it("a session that expires mid-signature yields no payment header", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const payment = client(guarded).createPayment(recordedRequirements(), { maxAmount: 10_000_000n });
    await vi.waitFor(() => expect(c.promptsOpened).toBe(1));
    await store.getState().end();
    c.approve();

    await expect(payment).rejects.toBeInstanceOf(SessionInvalidatedDuringSigningError);
  });

  it("CONTROL: with the session intact the same flow produces a payment header", async () => {
    const c = ceremonySigner();
    const guarded = withSessionGuard(c.signer, { getSession: sessionFromStore(store) });

    const payment = client(guarded).createPayment(recordedRequirements(), { maxAmount: 10_000_000n });
    await vi.waitFor(() => expect(c.promptsOpened).toBe(1));
    c.approve();

    const signed = await payment;
    expect(signed.header.length).toBeGreaterThan(0);
  });
});
