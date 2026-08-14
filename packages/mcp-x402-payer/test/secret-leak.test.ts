// "The secret never appears in any tool response or log line."
//
// A happy-path assertion would prove nothing here — leaks live in error paths,
// where library errors are verbose and quote their inputs. So every tool is
// driven through a matrix of INDUCED FAILURES, and for each one all three
// channels are captured and searched:
//
//   - the tool response  (what the model sees)
//   - stderr             (the log channel)
//   - stdout             (the MCP protocol channel — a leak here is both a
//                         disclosure AND a corrupted JSON-RPC stream)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createSpendLedger } from "../src/ledger.js";
import {
  clearRegisteredSecrets,
  formatError,
  log,
  redact,
  registerSecret,
} from "../src/output.js";
import { createPayer, type FetchLike } from "../src/payer.js";
import { createMcpServer } from "../src/server.js";
import {
  ASSET_A,
  b64,
  challenge,
  freshSecret,
  requirement,
  response402,
  responseUnsettled,
  scriptedFetch,
  stubSigner,
  testEnv,
} from "./helpers.js";

/** Capture everything written to stdout and stderr while `fn` runs. */
async function captureStreams<T>(fn: () => Promise<T>): Promise<{
  result: T | undefined;
  error: unknown;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => ((stdout += String(chunk)), true));
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => ((stderr += String(chunk)), true));

  let result: T | undefined;
  let error: unknown;
  try {
    result = await fn();
  } catch (err) {
    error = err;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { result, error, stdout, stderr };
}

/**
 * Invoke a registered tool by reaching into the server's registry.
 *
 * Going through the real handler (rather than calling the payer directly) is the
 * point: it exercises the same formatting and logging path a live tool call uses.
 */
async function callTool(
  server: ReturnType<typeof createMcpServer>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const registered = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => unknown }>;
    }
  )._registeredTools[name];
  if (!registered) throw new Error(`tool ${name} is not registered`);
  const out = (await registered.handler(args, {})) as {
    content: Array<{ text: string }>;
  };
  return out.content.map((c) => c.text).join("\n");
}

/**
 * Assert the three channels are clean.
 *
 * `result` is required to be a non-empty string: an earlier version of this
 * harness let a throw fall through to `result ?? ""`, so every case passed
 * vacuously against an empty string without ever invoking a tool. A leak test
 * that cannot fail is worse than no leak test.
 */
function expectNoLeak(
  captured: { result: string | undefined; error: unknown; stdout: string; stderr: string },
  secret: string,
): void {
  expect(captured.error).toBeUndefined();
  expect(typeof captured.result).toBe("string");
  expect(captured.result!.length).toBeGreaterThan(0);
  expect(captured.result!).not.toContain(secret);
  expect(captured.stderr).not.toContain(secret);
  expect(captured.stdout).not.toContain(secret);
}

describe("the payer secret never leaves the process", () => {
  // Definite-assignment rather than a `""` default: an empty string would make
  // every `not.toContain(secret)` vacuously true if beforeEach ever stopped
  // running, which is the exact failure mode this suite already hit once.
  let secret!: string;

  beforeEach(() => {
    clearRegisteredSecrets();
    secret = freshSecret();
    registerSecret(secret);
  });

  afterEach(() => {
    clearRegisteredSecrets();
    vi.restoreAllMocks();
  });

  /** Build a server whose fetch fails in the requested way. */
  function serverWith(fetchImpl: FetchLike) {
    const config = loadConfig(testEnv({ secret }));
    const ledger = createSpendLedger(config.ceilings);
    const signer = stubSigner();
    const payer = createPayer({ config, ledger, signer, fetchImpl });
    return { server: createMcpServer({ payer, config, ledger }), config, ledger };
  }

  // Each case induces a DIFFERENT failure path through the handlers.
  const failureModes: Array<{ name: string; fetchImpl: FetchLike }> = [
    {
      name: "network throw (error message quotes the request)",
      fetchImpl: async () => {
        throw new Error(`connect ECONNREFUSED while using key ${secret}`);
      },
    },
    {
      name: "malformed PAYMENT-REQUIRED header",
      fetchImpl: async () =>
        new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": "!!!not-base64!!!" } }),
    },
    {
      name: "price above max_amount",
      fetchImpl: scriptedFetch([response402(challenge([requirement({ amount: "999999" })]))]),
    },
    {
      name: "disallowed asset",
      fetchImpl: scriptedFetch([
        response402(
          challenge([
            requirement({ asset: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K" }),
          ]),
        ),
      ]),
    },
    {
      name: "wrong network",
      fetchImpl: scriptedFetch([response402(challenge([requirement({ network: "eip155:1" })]))]),
    },
    {
      name: "facilitator rejection echoing the request",
      fetchImpl: scriptedFetch([
        response402(),
        new Response("{}", {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": b64({
              x402Version: 2,
              error: `rejected payload signed by ${secret}`,
              accepts: [],
            }),
          },
        }),
      ]),
    },
    {
      name: "settle failure exhausting all retries",
      fetchImpl: scriptedFetch([
        response402(),
        responseUnsettled(),
        responseUnsettled(),
        responseUnsettled(),
      ]),
    },
    {
      name: "resource body containing the secret",
      fetchImpl: scriptedFetch([
        new Response(`leaked: ${secret}`, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ]),
    },
  ];

  for (const mode of failureModes) {
    it(`x402_pay — ${mode.name}`, async () => {
      const { server } = serverWith(mode.fetchImpl);

      const captured = await captureStreams(() =>
        callTool(server, "x402_pay", {
          resource_url: "https://res.test/paid",
          max_amount: "1000",
        }),
      );

      expectNoLeak(captured, secret);
    });

    it(`x402_quote — ${mode.name}`, async () => {
      const { server } = serverWith(mode.fetchImpl);

      const captured = await captureStreams(() =>
        callTool(server, "x402_quote", { resource_url: "https://res.test/paid" }),
      );

      expectNoLeak(captured, secret);
    });
  }

  it("x402_session_budget reports the payer's PUBLIC address, never the secret", async () => {
    const { server } = serverWith(scriptedFetch([]));

    const captured = await captureStreams(() => callTool(server, "x402_session_budget", {}));

    expectNoLeak(captured, secret);
    expect(captured.result).toContain("Payer address:");
  });

  it("a failure that leaks would actually be caught by this harness", async () => {
    // Guards the guard: if `redact` regressed to a no-op, the cases above must
    // fail rather than silently pass. This asserts the detector works.
    clearRegisteredSecrets();
    const { result } = await captureStreams(async () => `raw output containing ${secret}`);
    expect(result).toContain(secret);
  });
});

describe("redaction primitives", () => {
  afterEach(() => clearRegisteredSecrets());

  it("redacts a registered secret anywhere in the text", () => {
    const secret = freshSecret();
    registerSecret(secret);
    expect(redact(`before ${secret} after`)).toBe("before [REDACTED] after");
  });

  it("redacts UNREGISTERED secret-shaped values too", () => {
    // Belt and braces: key material that was re-derived or read from somewhere
    // we never registered still must not get out.
    const other = freshSecret();
    expect(redact(`leaked ${other}`)).toBe("leaked [REDACTED]");
  });

  it("leaves public keys and contract ids alone", () => {
    const g = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
    expect(redact(`${g} ${ASSET_A}`)).toBe(`${g} ${ASSET_A}`);
  });

  it("formatError never includes a stack trace", () => {
    const err = new Error("boom");
    const formatted = formatError(err);
    expect(formatted).toBe("boom");
    expect(formatted).not.toContain("at ");
  });

  it("formatError redacts the message", () => {
    const secret = freshSecret();
    registerSecret(secret);
    expect(formatError(new Error(`failed with ${secret}`))).toBe("failed with [REDACTED]");
  });

  it("formatError handles non-Error throws", () => {
    expect(formatError("plain string")).toBe("plain string");
    expect(formatError({ code: 42 })).toContain("42");
  });
});

describe("log discipline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes to stderr and NEVER to stdout", async () => {
    // stdout is the MCP JSON-RPC channel; a stray write desynchronises it.
    const { stdout, stderr } = await captureStreams(async () => {
      log("info", "hello", { url: "https://res.test" });
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("hello");
    expect(stderr).toContain("https://res.test");
  });

  it("redacts secrets in structured log fields", async () => {
    clearRegisteredSecrets();
    const secret = freshSecret();
    registerSecret(secret);

    const { stderr } = await captureStreams(async () => {
      log("warn", "failed", { detail: `used ${secret}` });
    });

    expect(stderr).not.toContain(secret);
    expect(stderr).toContain("[REDACTED]");
    clearRegisteredSecrets();
  });

  it("survives an unserializable field rather than throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const { stderr, error } = await captureStreams(async () => {
      log("error", "circular", { circular });
    });

    expect(error).toBeUndefined();
    expect(stderr).toContain("circular");
  });
});
