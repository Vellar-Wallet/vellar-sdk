import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_DEFAULTS,
  createTunedRpcTransport,
  detectEnvironment,
  NODE_DEFAULTS,
  resolveConnectionSettings,
  type ConnectionPool,
  type FetchLike,
} from "./rpc-connection-reuse";

const RPC_URL = "https://soroban-testnet.stellar.org";

function okFetch(): FetchLike {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

describe("resolveConnectionSettings", () => {
  it("applies the Node keep-alive defaults", () => {
    const settings = resolveConnectionSettings({ environment: "node" });

    expect(settings).toMatchObject({
      environment: "node",
      keepAlive: true,
      keepAliveMsecs: NODE_DEFAULTS.keepAliveMsecs,
      maxSockets: NODE_DEFAULTS.maxSockets,
      maxFreeSockets: NODE_DEFAULTS.maxFreeSockets,
    });
    expect(settings.headers).toEqual({ Connection: "keep-alive" });
  });

  it("honours caller overrides in Node", () => {
    const settings = resolveConnectionSettings({
      environment: "node",
      keepAliveMsecs: 5_000,
      maxSockets: 3,
      maxFreeSockets: 1,
    });

    expect(settings.keepAliveMsecs).toBe(5_000);
    expect(settings.maxSockets).toBe(3);
    expect(settings.maxFreeSockets).toBe(1);
  });

  it("emits Connection: close when keep-alive is explicitly disabled", () => {
    const settings = resolveConnectionSettings({ environment: "node", keepAlive: false });
    expect(settings.headers).toEqual({ Connection: "close" });
  });

  it("sets no Connection header in the browser, where it is forbidden", () => {
    const settings = resolveConnectionSettings({ environment: "browser" });

    expect(settings.headers).toEqual({});
    expect(settings).toMatchObject(BROWSER_DEFAULTS);
  });

  it("detects the environment when none is given", () => {
    // The test runner is Node, so there is no window.document.
    expect(detectEnvironment()).toBe("node");
    expect(resolveConnectionSettings().environment).toBe("node");
  });
});

describe("createTunedRpcTransport", () => {
  it("reuses one pool across repeated calls to the same origin", async () => {
    const pool: ConnectionPool = { keepAliveTimeout: 30_000, connections: 10 };
    const fetchImpl = okFetch();
    const transport = createTunedRpcTransport({ environment: "node" }, { fetchImpl, pool });

    for (let i = 0; i < 5; i++) {
      await transport.fetch(RPC_URL, { method: "POST" });
    }

    expect(transport.requestCount()).toBe(5);
    // One origin => one warm pool, not five independent connections.
    expect(transport.origins()).toEqual(["https://soroban-testnet.stellar.org"]);

    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(5);
    // Every request carried the SAME dispatcher instance — that identity is
    // what makes the socket reusable rather than per-request.
    for (const [, init] of calls) {
      expect(init.dispatcher).toBe(pool);
      expect(init.headers).toMatchObject({ Connection: "keep-alive" });
    }
  });

  it("attaches no dispatcher in the browser", async () => {
    const pool: ConnectionPool = { keepAliveTimeout: 30_000, connections: 10 };
    const fetchImpl = okFetch();
    const transport = createTunedRpcTransport({ environment: "browser" }, { fetchImpl, pool });

    await transport.fetch(RPC_URL, { method: "POST" });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.dispatcher).toBeUndefined();
    expect(init.headers).not.toHaveProperty("Connection");
  });

  it("attaches no dispatcher when keep-alive is disabled", async () => {
    const pool: ConnectionPool = { keepAliveTimeout: 30_000, connections: 10 };
    const fetchImpl = okFetch();
    const transport = createTunedRpcTransport(
      { environment: "node", keepAlive: false },
      { fetchImpl, pool },
    );

    await transport.fetch(RPC_URL, { method: "POST" });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.dispatcher).toBeUndefined();
    expect(init.headers).toMatchObject({ Connection: "close" });
  });

  it("does not let tuned headers clobber caller headers", async () => {
    const fetchImpl = okFetch();
    const transport = createTunedRpcTransport({ environment: "node" }, { fetchImpl });

    await transport.fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers).toEqual({
      Connection: "keep-alive",
      "content-type": "application/json",
    });
  });

  it("tracks distinct origins separately", async () => {
    const fetchImpl = okFetch();
    const transport = createTunedRpcTransport({ environment: "node" }, { fetchImpl });

    await transport.fetch(RPC_URL, { method: "POST" });
    await transport.fetch("https://soroban.stellar.org", { method: "POST" });
    await transport.fetch(RPC_URL, { method: "POST" });

    expect(transport.requestCount()).toBe(3);
    expect(transport.origins()).toEqual([
      "https://soroban-testnet.stellar.org",
      "https://soroban.stellar.org",
    ]);
  });
});
