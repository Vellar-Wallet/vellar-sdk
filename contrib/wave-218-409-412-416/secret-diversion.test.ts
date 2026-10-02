import { describe, expect, it, vi } from "vitest";
import { REDACTED, SecretRedactor } from "./secret-diversion";

describe("stdout diversion secret leak prevention (#416)", () => {
  const registeredSecret = "SB5V7OELK7N7O344B6P52G74E2ZVRWTRB3R722OQZ4F27HAKV2EQ626A";
  const unregisteredSecret = "SC5V7OELK7N7O344B6P52G74E2ZVRWTRB3R722OQZ4F27HAKV2EQ626B";

  it("diverts plain stdout output to stderr with prefix", () => {
    const redactor = new SecretRedactor();
    const stderrBuffer: string[] = [];

    const mockStdout = {
      write: vi.fn(),
    };
    const mockStderr = {
      write: vi.fn((str: string) => {
        stderrBuffer.push(str);
        return true;
      }),
    };

    const restore = redactor.divertStdoutToStderr(mockStdout as any, mockStderr as any);

    mockStdout.write("normal debug output from dependency\n");
    expect(stderrBuffer.join("")).toBe("[diverted-stdout] normal debug output from dependency\n");

    restore();
  });

  it("redacts registered secret from diverted stdout output", () => {
    const redactor = new SecretRedactor();
    redactor.registerSecret(registeredSecret);

    const stderrBuffer: string[] = [];
    const mockStdout = { write: vi.fn() };
    const mockStderr = {
      write: vi.fn((str: string) => {
        stderrBuffer.push(str);
        return true;
      }),
    };

    const restore = redactor.divertStdoutToStderr(mockStdout as any, mockStderr as any);

    mockStdout.write(`API key used: ${registeredSecret}`);
    const output = stderrBuffer.join("");
    expect(output).not.toContain(registeredSecret);
    expect(output).toContain(REDACTED);
    expect(output).toBe(`[diverted-stdout] API key used: ${REDACTED}`);

    restore();
  });

  it("redacts unregistered Stellar secret seed from diverted output", () => {
    const redactor = new SecretRedactor();
    const stderrBuffer: string[] = [];
    const mockStdout = { write: vi.fn() };
    const mockStderr = {
      write: vi.fn((str: string) => {
        stderrBuffer.push(str);
        return true;
      }),
    };

    const restore = redactor.divertStdoutToStderr(mockStdout as any, mockStderr as any);

    mockStdout.write(`Generated new keypair seed: ${unregisteredSecret}`);
    const output = stderrBuffer.join("");
    expect(output).not.toContain(unregisteredSecret);
    expect(output).toContain(REDACTED);
    expect(output).toBe(`[diverted-stdout] Generated new keypair seed: ${REDACTED}`);

    restore();
  });

  it("restores original stdout write method upon cleanup", () => {
    const redactor = new SecretRedactor();
    const originalWrite = vi.fn();
    const mockStdout = { write: originalWrite };
    const mockStderr = { write: vi.fn() };

    const restore = redactor.divertStdoutToStderr(mockStdout as any, mockStderr as any);
    expect(mockStdout.write).not.toBe(originalWrite);

    restore();
    expect(mockStdout.write).toBe(originalWrite);
  });
});
