# full-create-connect

Reference example demonstrating a full create and connect wallet flow using mocked passkey kit and backend dependencies.

## Flow

1. Create a new wallet (passkey registration + backend submission).
2. Build a session from the result.
3. Simulate a page reload.
4. Reconnect using the resulting keyId.
5. Backend lookup confirms the mapping.

All dependencies are mocked within the example.

## Usage

```ts
import { createMockPasskeyKit, createMockBackend, createWalletSession } from "./index";

const kit = createMockPasskeyKit();
const backend = createMockBackend();

const { keyIdBase64, contractId, signedTx } = await kit.createWallet("App", "user");
const { sessionId } = await backend.submitWalletCreation({ keyId: keyIdBase64, contractId, network: "testnet", signedTx });
const session = createWalletSession(contractId, keyIdBase64, sessionId);

// After reload:
const reconnected = await kit.connectWallet({ keyId: keyIdBase64 });
const lookup = await backend.lookupContractId({ keyId: keyIdBase64, network: "testnet" });