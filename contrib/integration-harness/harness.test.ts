import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL, CONTRACT, token, build, fakeKit, fakeSac, makeMockServer } from "./harness";

const tokenInfo = token;

describe("client.ts ↔ http-backend.ts integration harness (contrib)", () => {
  beforeEach(() => {
    // connect() runs a passkey (WebAuthn) ceremony guard; simulate the browser.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeKit() {
    return {
      createWallet: vi.fn(async () => ({
        keyIdBase64: "key123",
        contractId: CONTRACT,
        signedTx: "deploy-xdr",
      })),
      connectWallet: vi.fn(
        async (opts?: { getContractId?: (keyId: string) => Promise<string | undefined> }) => {
          await opts?.getContractId?.("key123");
          return { keyIdBase64: "key123", contractId: CONTRACT };
        },
      ),
      sign: vi.fn(async (tx: unknown) => tx),
      wallet: undefined,
    } as unknown as PasskeyKitLike;
  }

  function fakeSac() {
    const transfer = vi.fn(async () => "transfer-xdr");
    return {
      getSACClient: vi.fn(() => ({ transfer })),
      _transfer: transfer,
    };
  }

  function build() {
    const calls: string[] = [];
    const kit = fakeKit();
    const sac = fakeSac();
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      kit,
      backend: createHttpWalletBackend(API_URL, makeMockServer({ calls })),
      sac,
      isValidAddress: () => true,
    });
    return { wallet, kit, sac, calls };
  }

  it("initializes the wallet through the mock backend and sets the session", async () => {
    const { wallet, calls } = build();

    const session = await wallet.connect();

    expect(session.accountId).toBe(CONTRACT);
    expect(session.network).toBe("testnet");
    expect(wallet.session).toBe(session);
    // The connector resolved the contract id via the backend's /wallet/connect.
    expect(calls).toContain("POST /wallet/connect");
  });

  it("fetches a balance from the backend after wallet initialization", async () => {
    const { wallet, calls } = build();

    const session = await wallet.connect();
    // The balance call goes through the harness server; the harness serves it
    // when the client queries /wallet/balance after connect().
    expect(calls).toContain("POST /wallet/balance");
  });

  it("submits a payment through the mock backend after initialization", async () => {
    const { wallet, kit, sac, calls } = build();

    await wallet.connect();
    const result = await wallet.pay({ to: "CDEST", amount: 5n, token: tokenInfo });

    expect(sac.getSACClient).toHaveBeenCalledWith("CTOKEN");
    expect(kit.sign).toHaveBeenCalledOnce();
    expect(calls).toContain("POST /wallet/submit");
    expect(result.hash).toBe("txhash-submit");
  });
});