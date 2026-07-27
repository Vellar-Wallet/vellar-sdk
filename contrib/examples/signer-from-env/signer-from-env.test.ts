import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createSessionKeySignerFromEnv, DEFAULT_ENV_VAR } from "./signer-from-env";

const C_ADDRESS = "CC5ZSTLTYKPNIFDSJ4233RVZPALGHHDBRTXGIN6Z3AJCWU57VR5ITXXR";

describe("createSessionKeySignerFromEnv", () => {
  afterEach(() => {
    delete process.env[DEFAULT_ENV_VAR];
    delete process.env["CUSTOM_ENV_VAR"];
  });

  it("throws a clear error when the env var is unset", () => {
    delete process.env[DEFAULT_ENV_VAR];
    expect(() => createSessionKeySignerFromEnv(C_ADDRESS)).toThrow(
      /environment variable "VELLAR_SESSION_KEY_SECRET" is not set/,
    );
  });

  it("throws a clear error when the env var is malformed", () => {
    process.env[DEFAULT_ENV_VAR] = "not-a-secret-key";
    expect(() => createSessionKeySignerFromEnv(C_ADDRESS)).toThrow(
      /does not look like a Stellar secret key/,
    );
  });

  it("builds a session-key signer from a valid secret in the default env var", () => {
    const kp = Keypair.random();
    process.env[DEFAULT_ENV_VAR] = kp.secret();
    const signer = createSessionKeySignerFromEnv(C_ADDRESS);
    expect(signer.address).toBe(C_ADDRESS);
  });

  it("honors a custom env var name", () => {
    const kp = Keypair.random();
    process.env["CUSTOM_ENV_VAR"] = kp.secret();
    const signer = createSessionKeySignerFromEnv(C_ADDRESS, "CUSTOM_ENV_VAR");
    expect(signer.address).toBe(C_ADDRESS);
  });
});
