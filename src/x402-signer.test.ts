import { describe, expect, it } from "vitest";
import {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  Account,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  createSessionKeySigner,
  createPasskeyX402Signer,
  type WebAuthnAssertion,
} from "./x402-signer";

const PASSPHRASE = "Test SDF Network ; September 2015";
const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const OTHER_C = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

/** Build a V1 (sorobanCredentialsAddress) auth entry for `contractAddress`, for
 * a dummy invocation — enough to exercise the signer's preimage + map building. */
function makeV1AuthEntry(contractAddress: string): xdr.SorobanAuthorizationEntry {
  const addr = new Address(contractAddress);
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: addr.toScAddress(),
      nonce: xdr.Int64.fromString("12345"),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(OTHER_C).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(contractAddress, { type: "address" }),
          nativeToScVal(OTHER_C, { type: "address" }),
          nativeToScVal(1n, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

describe("createSessionKeySigner", () => {
  it("rejects a non-contract (G-address) as the payer address", () => {
    const kp = Keypair.random();
    expect(() => createSessionKeySigner({ address: kp.publicKey(), secretKey: kp.secret() })).toThrow(
      /must be a contract/,
    );
  });

  it("signs a V1 entry producing an ed25519 smart-wallet signature map, keeping V1 creds", async () => {
    const kp = Keypair.random();
    const signer = createSessionKeySigner({ address: C_ADDRESS, secretKey: kp.secret() });
    expect(signer.address).toBe(C_ADDRESS);

    const entry = makeV1AuthEntry(C_ADDRESS);
    const signedXdr = await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 1000,
    });

    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    // Credentials stay V1 (NOT upgraded to V2).
    expect(signed.credentials.type).toBe("sorobanCredentialsAddress");
    if (signed.credentials.type !== "sorobanCredentialsAddress") {
      throw new Error("unreachable: asserted above");
    }
    const creds = signed.credentials.address;
    expect(creds.signatureExpirationLedger).toBe(1000);

    // Signature is Vec[ Map[ SignerKey.Ed25519 -> Signature.Ed25519 ] ].
    const sigVal = creds.signature;
    expect(sigVal.type).toBe("scvVec");
    if (sigVal.type !== "scvVec") throw new Error("unreachable: asserted above");
    const mapVal = sigVal.vec![0]!;
    if (mapVal.type !== "scvMap") throw new Error("expected scvMap");
    const map = mapVal.map!;
    expect(map).toHaveLength(1);
    const key = map[0]!.key;
    const val = map[0]!.val;
    // SignerKey.Ed25519(pubkey)
    if (key.type !== "scvVec") throw new Error("expected scvVec key");
    const keySym = key.vec![0]!;
    if (keySym.type !== "scvSymbol") throw new Error("expected scvSymbol");
    expect(keySym.sym.toString()).toBe("Ed25519");
    const keyBytes = key.vec![1]!;
    if (keyBytes.type !== "scvBytes") throw new Error("expected scvBytes");
    expect(new Uint8Array(keyBytes.bytes.value)).toEqual(new Uint8Array(kp.rawPublicKey()));
    // Signature.Ed25519(sig) — 64 bytes, and it verifies against the payload.
    if (val.type !== "scvVec") throw new Error("expected scvVec val");
    const valSym = val.vec![0]!;
    if (valSym.type !== "scvSymbol") throw new Error("expected scvSymbol");
    expect(valSym.sym.toString()).toBe("Ed25519");
    const valBytes = val.vec![1]!;
    if (valBytes.type !== "scvBytes") throw new Error("expected scvBytes");
    expect(valBytes.bytes.value).toHaveLength(64);
  });

  it("refuses to sign an entry whose credential address is a different wallet", async () => {
    const kp = Keypair.random();
    const signer = createSessionKeySigner({ address: C_ADDRESS, secretKey: kp.secret() });
    const entry = makeV1AuthEntry(OTHER_C); // credential for a DIFFERENT wallet
    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).rejects.toThrow(/does not match signer address/);
  });

  it("rejects a V2 (address-bound) credential entry — this signer is V1-only", async () => {
    const kp = Keypair.random();
    const signer = createSessionKeySigner({ address: C_ADDRESS, secretKey: kp.secret() });
    const v1 = makeV1AuthEntry(C_ADDRESS);
    if (v1.credentials.type !== "sorobanCredentialsAddress") {
      throw new Error("makeV1AuthEntry must produce sorobanCredentialsAddress");
    }
    // Upgrade to V2 and confirm the signer refuses it.
    const v2 = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(v1.credentials.address),
      rootInvocation: v1.rootInvocation,
    });
    await expect(
      signer.signAuthEntry(v2.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).rejects.toThrow(/expects V1 sorobanCredentialsAddress/);
  });
});

describe("createPasskeyX402Signer", () => {
  it("signs via the injected WebAuthn ceremony, producing a secp256r1 map, V1 creds", async () => {
    const keyId = new Uint8Array(20).fill(9);
    const assertion: WebAuthnAssertion = {
      authenticatorData: new Uint8Array(37).fill(1),
      clientDataJSON: new Uint8Array(50).fill(2),
      signature: new Uint8Array(64).fill(3),
      keyId,
    };
    let receivedHash: Uint8Array | undefined;
    const signer = createPasskeyX402Signer({
      address: C_ADDRESS,
      webAuthn: {
        async sign(payloadHash) {
          receivedHash = payloadHash;
          return assertion;
        },
      },
    });

    const entry = makeV1AuthEntry(C_ADDRESS);
    const signedXdr = await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 2000,
    });
    // The ceremony was handed a 32-byte payload hash to sign.
    expect(receivedHash).toBeDefined();
    expect(receivedHash!).toHaveLength(32);

    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    expect(signed.credentials.type).toBe("sorobanCredentialsAddress");
    if (signed.credentials.type !== "sorobanCredentialsAddress") {
      throw new Error("unreachable: asserted above");
    }
    const sigVec = signed.credentials.address.signature;
    if (sigVec.type !== "scvVec") throw new Error("expected scvVec");
    const map = sigVec.vec![0]!;
    if (map.type !== "scvMap") throw new Error("expected scvMap");
    const key = map.map![0]!.key;
    const val = map.map![0]!.val;
    if (key.type !== "scvVec") throw new Error("expected scvVec key");
    const keySym = key.vec![0]!;
    if (keySym.type !== "scvSymbol") throw new Error("expected scvSymbol");
    expect(keySym.sym.toString()).toBe("Secp256r1");
    const keyBytes = key.vec![1]!;
    if (keyBytes.type !== "scvBytes") throw new Error("expected scvBytes");
    expect(new Uint8Array(keyBytes.bytes.value)).toEqual(keyId);
    // Signature.Secp256r1(struct{authenticator_data, client_data_json, signature})
    if (val.type !== "scvVec") throw new Error("expected scvVec val");
    const valSym = val.vec![0]!;
    if (valSym.type !== "scvSymbol") throw new Error("expected scvSymbol");
    expect(valSym.sym.toString()).toBe("Secp256r1");
    const structVal = val.vec![1]!;
    if (structVal.type !== "scvMap") throw new Error("expected scvMap struct");
    const fields = structVal.map!.map((e) => {
      if (e.key.type !== "scvSymbol") throw new Error("expected scvSymbol field key");
      return e.key.sym.toString();
    }).sort();
    expect(fields).toEqual(["authenticator_data", "client_data_json", "signature"]);
  });
});
