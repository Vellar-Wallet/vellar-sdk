import { createMockPasskeyKit, createMockBackend, createWalletSession } from "./index";

console.log("full-create-connect tests:");

{
  const kit = createMockPasskeyKit();
  const backend = createMockBackend();

  // 1) Create wallet
  const { keyIdBase64, contractId, signedTx } = await kit.createWallet("TestApp", "test-user");
  console.assert(keyIdBase64.length > 0, "expected keyId");
  console.assert(contractId.length > 0, "expected contractId");
  console.log("ok: createWallet → keyId:", keyIdBase64, "contractId:", contractId);

  // 2) Backend submission
  const { sessionId } = await backend.submitWalletCreation({ keyId: keyIdBase64, contractId, network: "testnet", signedTx });
  console.assert(sessionId.length > 0, "expected sessionId");
  console.log("ok: submitWalletCreation → sessionId:", sessionId);

  // 3) Build session
  const session = createWalletSession(contractId, keyIdBase64, sessionId);
  console.assert(session.connected === true, "expected connected");
  console.assert(session.keyId === keyIdBase64, "expected keyId in session");
  console.log("ok: session created with keyId");

  // 4) Simulate reload: reconnect using keyId
  const reconnected = await kit.connectWallet({ keyId: keyIdBase64 });
  console.assert(reconnected.keyIdBase64 === keyIdBase64, "expected same keyId on reconnect");
  console.log("ok: reconnect with keyId → same keyId");

  // 5) Backend lookup
  const lookup = await backend.lookupContractId({ keyId: keyIdBase64, network: "testnet" });
  console.assert(lookup !== undefined, "expected lookup result");
  console.assert(lookup!.contractId.length > 0, "expected contractId from lookup");
  console.log("ok: backend lookup → contractId:", lookup!.contractId);
}

console.log("full-create-connect tests passed");