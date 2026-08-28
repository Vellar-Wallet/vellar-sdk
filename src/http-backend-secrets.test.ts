import { describe, it, expect } from "vitest";
import { sanitizeSecrets, createHttpWalletBackend } from "./http-backend";

describe("Issue #256 — Secrets Sanitization in HTTP Backend", () => {
  it("redacts Bearer tokens, secret keys, and passwords from error messages", () => {
    const rawError = "Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN failed with sk_live_983748293482348 and apiKey=supersecretpass";
    const sanitized = sanitizeSecrets(rawError);

    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(sanitized).not.toContain("sk_live_983748293482348");
    expect(sanitized).not.toContain("supersecretpass");
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("[REDACTED_SECRET_KEY]");
    expect(sanitized).toContain("apiKey=[REDACTED]");
  });

  it("redacts sensitive tokens returned in 401/500 API responses", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: "Invalid token Bearer secret_session_token_12345",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );

    const backend = createHttpWalletBackend("https://api.vellar.test", mockFetch as unknown as typeof fetch);

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" })
    ).rejects.toThrow(/Invalid token Bearer \[REDACTED\]/);
  });
});
