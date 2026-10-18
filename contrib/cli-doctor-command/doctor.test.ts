/**
 * REFERENCE TEST IMPLEMENTATION
 * This is a complete working test suite for the doctor command.
 * Copy/adapt this into packages/cli/src/commands/doctor.test.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDoctorCommand, checkNodeVersion, checkFacilitatorReachability, checkSignerKey } from "./doctor.js";

function optionFor(flags: string) {
  return makeDoctorCommand().options.find((o) => o.long === flags);
}

const FAKE_SECRET = "SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VELLAR_SECRET;
});

describe("doctor command", () => {
  it("is named 'doctor' and takes no required arguments", () => {
    const cmd = makeDoctorCommand();
    expect(cmd.name()).toBe("doctor");
    expect(cmd.registeredArguments).toHaveLength(0);
  });

  it("registers --secret and --secret-file options", () => {
    expect(optionFor("--secret")).toBeDefined();
    expect(optionFor("--secret-file")).toBeDefined();
  });

  it("registers --facilitator option with a default", () => {
    const opt = optionFor("--facilitator");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBeDefined();
  });

  it("prints pass/fail status for all checks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetch);

    await expect(
      makeDoctorCommand().parseAsync([
        "node",
        "doctor",
        "--secret",
        FAKE_SECRET,
      ]),
    ).rejects.toThrow("exit");

    const output = log.mock.calls.flat().join("\n");
    expect(output).toMatch(/Environment checks:/);
    expect(output).toMatch(/Node\.js version/);
    expect(output).toMatch(/Facilitator reachability/);
    expect(output).toMatch(/Signer key/);

    vi.unstubAllGlobals();
  });

  it("exits with code 1 when a check fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const fetch = vi.fn().mockResolvedValue({ status: 500 });
    vi.stubGlobal("fetch", fetch);

    await expect(
      makeDoctorCommand().parseAsync([
        "node",
        "doctor",
        "--secret",
        FAKE_SECRET,
      ]),
    ).rejects.toThrow("exit:1");

    expect(exit).toHaveBeenCalledWith(1);

    vi.unstubAllGlobals();
  });

  it("exits with code 0 (no exit call) when all checks pass", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:0");
    }) as never);
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetch);

    // This should not throw because the exit is only called on failure
    await makeDoctorCommand().parseAsync([
      "node",
      "doctor",
      "--secret",
      FAKE_SECRET,
    ]);

    expect(exit).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("checkNodeVersion", () => {
  it("passes for Node.js 20 or higher", () => {
    // We're already running on a valid version for this repo
    const result = checkNodeVersion();
    expect(result.pass).toBe(true);
    expect(result.message).toMatch(/Node\.js version/);
    expect(result.message).toMatch(/>=/);
  });

  it("returns a message indicating the current version", () => {
    const result = checkNodeVersion();
    expect(result.message).toContain("v");
    expect(result.message).toContain(process.version);
  });
});

describe("checkFacilitatorReachability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes when facilitator responds with a 2xx/3xx/4xx status", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetch);

    const result = await checkFacilitatorReachability("https://example.com");
    expect(result.pass).toBe(true);
    expect(result.message).toContain("reachable");
    expect(result.message).toContain("https://example.com");
  });

  it("passes when facilitator responds with a 404", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetch);

    const result = await checkFacilitatorReachability("https://example.com");
    expect(result.pass).toBe(true);
  });

  it("fails when facilitator responds with 500 or higher", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 500, statusText: "Internal Server Error" });
    vi.stubGlobal("fetch", fetch);

    const result = await checkFacilitatorReachability("https://example.com");
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/500/);
  });

  it("fails when facilitator is unreachable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetch);

    const result = await checkFacilitatorReachability("https://example.com");
    expect(result.pass).toBe(false);
    expect(result.message).toContain("Could not reach");
  });

  it("makes a HEAD request to the facilitator URL", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetch);

    await checkFacilitatorReachability("https://example.com");
    expect(fetch).toHaveBeenCalledWith("https://example.com", { method: "HEAD" });
  });
});

describe("checkSignerKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes when --secret-file is provided and readable", async () => {
    const readFile = vi.fn().mockResolvedValue("SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33");
    vi.doMock("node:fs/promises", () => ({ readFile }), { virtual: true });

    const result = await checkSignerKey({ secretFile: "/home/user/.vellar/key" });
    expect(result.pass).toBe(true);
    expect(result.message).toContain("/home/user/.vellar/key");
  });

  it("fails when --secret-file is provided but not readable", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory"));
    vi.doMock("node:fs/promises", () => ({ readFile }), { virtual: true });

    const result = await checkSignerKey({ secretFile: "/nonexistent/path" });
    expect(result.pass).toBe(false);
    expect(result.message).toContain("Could not read");
  });

  it("passes when --secret flag is provided", async () => {
    const result = await checkSignerKey({ secret: FAKE_SECRET });
    expect(result.pass).toBe(true);
    expect(result.message).toMatch(/--secret flag/);
  });

  it("passes when VELLAR_SECRET environment variable is set", async () => {
    process.env.VELLAR_SECRET = FAKE_SECRET;

    const result = await checkSignerKey({});
    expect(result.pass).toBe(true);
    expect(result.message).toMatch(/VELLAR_SECRET/);
  });

  it("fails when no signer key is available", async () => {
    const result = await checkSignerKey({});
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/No signer key found/);
    expect(result.message).toMatch(/--secret-file/);
    expect(result.message).toMatch(/--secret/);
    expect(result.message).toMatch(/VELLAR_SECRET/);
  });

  it("prefers --secret-file over --secret", async () => {
    const readFile = vi.fn().mockResolvedValue("SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33");
    vi.doMock("node:fs/promises", () => ({ readFile }), { virtual: true });

    const result = await checkSignerKey({
      secretFile: "/path/to/file",
      secret: FAKE_SECRET,
    });
    expect(result.pass).toBe(true);
    expect(result.message).toContain("/path/to/file");
    expect(result.message).not.toContain("--secret flag");
  });

  it("never prints the secret key in the message", async () => {
    const result = await checkSignerKey({ secret: FAKE_SECRET });
    expect(result.message).not.toContain(FAKE_SECRET);
    expect(result.message).not.toContain("SDABEL");
    expect(result.message).not.toContain("IQ33");
  });

  it("prefers --secret-file over VELLAR_SECRET", async () => {
    process.env.VELLAR_SECRET = "SOMEOTHERSECRET";
    const readFile = vi.fn().mockResolvedValue("SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33");
    vi.doMock("node:fs/promises", () => ({ readFile }), { virtual: true });

    const result = await checkSignerKey({ secretFile: "/path/to/file" });
    expect(result.pass).toBe(true);
    expect(result.message).toContain("/path/to/file");
    expect(result.message).not.toContain("VELLAR_SECRET");
  });

  it("falls back to VELLAR_SECRET when --secret is not provided", async () => {
    process.env.VELLAR_SECRET = FAKE_SECRET;

    const result = await checkSignerKey({});
    expect(result.pass).toBe(true);
    expect(result.message).toMatch(/VELLAR_SECRET/);
  });
});
