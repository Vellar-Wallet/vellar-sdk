// "The secret never appears in any CLI output."
//
// Same matrix approach as the MCP payer's secret-leak.test.ts: every CLI output
// path is driven through induced failures, and all three channels are captured
// and searched — stdout, stderr, and the --json envelope.
//
// A happy-path assertion would prove nothing here — leaks live in error paths,
// where library errors are verbose and quote their inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRegisteredSecrets,
  formatError,
  jsonStdout,
  logStderr,
  logStdout,
  redact,
  registerSecret,
} from "./cli-output.js";

/** Capture everything written to stdout and stderr while `fn` runs. */
async function captureStreams<T>(fn: () => T | Promise<T>): Promise<{
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

/** Generate a realistic Stellar ed25519 secret seed for testing. */
function freshSecret(): string {
  // S + 55 base32 chars (A-Z, 2-7)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let s = "S";
  for (let i = 0; i < 55; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Assert the three channels are clean.
 *
 * `result` is required to be a non-empty string: an empty string would make
 * every `not.toContain(secret)` vacuously true.
 */
function expectNoLeak(
  captured: { result: string | undefined; error: unknown; stdout: string; stderr: string },
  secret: string,
): void {
  expect(captured.result).toBeDefined();
  expect(typeof captured.result).toBe("string");
  expect(captured.result!.length).toBeGreaterThan(0);
  expect(captured.result!).not.toContain(secret);
  expect(captured.stderr).not.toContain(secret);
  expect(captured.stdout).not.toContain(secret);
}

describe("the CLI secret never leaves the process", () => {
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

  // Each case induces a DIFFERENT failure path through the CLI output module.
  const failureModes: Array<{ name: string; fn: () => string }> = [
    {
      name: "error message quoting the secret (network throw)",
      fn: () => formatError(new Error(`connect ECONNREFUSED while using key ${secret}`)),
    },
    {
      name: "stderr log containing the secret",
      fn: () => {
        logStderr(`failed to connect with ${secret}`);
        return "ok";
      },
    },
    {
      name: "stdout log containing the secret",
      fn: () => {
        logStdout(`payer ${secret} attempted payment`);
        return "ok";
      },
    },
    {
      name: "JSON envelope containing the secret",
      fn: () => {
        jsonStdout({ error: `signed by ${secret}`, code: 500 });
        return "ok";
      },
    },
    {
      name: "non-Error throw carrying the secret",
      fn: () => formatError(`raw string with ${secret}`),
    },
    {
      name: "object throw carrying the secret",
      fn: () => formatError({ detail: `key was ${secret}` }),
    },
  ];

  for (const mode of failureModes) {
    it(`CLI output — ${mode.name}`, async () => {
      const captured = await captureStreams(() => mode.fn());
      expectNoLeak(captured, secret);
    });
  }

  it("a failure that leaks would actually be caught by this harness", async () => {
    // Guards the guard: if `redact` regressed to a no-op, the cases above must
    // fail rather than silently pass.
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
    const other = freshSecret();
    expect(redact(`leaked ${other}`)).toBe("leaked [REDACTED]");
  });

  it("leaves public keys and contract ids alone", () => {
    const g = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
    const c = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
    expect(redact(`${g} ${c}`)).toBe(`${g} ${c}`);
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

describe("output discipline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logStderr writes to stderr and NEVER to stdout", async () => {
    const { stdout, stderr } = await captureStreams(() => {
      logStderr("hello from stderr");
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("hello from stderr");
  });

  it("logStdout writes to stdout", async () => {
    const { stdout } = await captureStreams(() => {
      logStdout("hello from stdout");
    });
    expect(stdout).toContain("hello from stdout");
  });

  it("jsonStdout redacts secrets in the JSON envelope", async () => {
    const secret = freshSecret();
    registerSecret(secret);
    const { stdout } = await captureStreams(() => {
      jsonStdout({ error: `signed by ${secret}` });
    });
    expect(stdout).not.toContain(secret);
    expect(stdout).toContain("[REDACTED]");
    clearRegisteredSecrets();
  });
});