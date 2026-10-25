# Mainnet Config with a Local Mock Soroban RPC Provider (`#633`)

> **WARNING — LOCAL TESTING ONLY**
> This example and its synthetic `LOCAL_TEST_ONLY_MAINNET_WASM_HASH` constant are **strictly for local testing and CI verification**. They are **never suitable for a real mainnet transaction**. Never submit real mainnet transactions against an unverified WASM hash or an untrusted RPC endpoint.

## Overview

The Stellar Development Foundation (SDF) does not operate a free public Soroban RPC for mainnet, and `passkey-kit` requires integrators to pin the exact smart-wallet WASM hash from their deployment manifest. Consequently, `vellar-sdk` leaves `MAINNET.rpcUrl` and `MAINNET.walletWasmHash` blank by default and provides `mainnetConfig({ rpcUrl, walletWasmHash })` to construct a validated `NetworkConfig`.

This contrib example shows how to exercise mainnet-shaped configuration and validation code paths locally without a paid mainnet RPC provider or real funds:

1. **Local Mock Soroban RPC (`startMockMainnetRpcServer`)**: Spawns an ephemeral `http://127.0.0.1:<port>` JSON-RPC 2.0 server responding to `getHealth`, `getNetwork`, and `getLatestLedger` with the canonical mainnet passphrase (`Public Global Stellar Network ; September 2015`).
2. **Config Construction (`mainnetConfig`)**: Builds a complete `NetworkConfig` combining the caller-supplied `rpcUrl` and `walletWasmHash` with the SDK's verified mainnet constants (`networkPassphrase`, `horizonUrl`, `nativeTokenContractId`, `usdcIssuer`, and `usdcContractId`).
3. **Deployment-Equivalent Validation (`validateMainnetNetworkConfig`)**: Verifies deterministic SAC contract ID derivations for XLM and Circle USDC on `Networks.PUBLIC`, rejects accidental reuse of `TESTNET.walletWasmHash`, and confirms the RPC endpoint's `getNetwork` passphrase matches `config.networkPassphrase`.

## Running the Example

```bash
npx tsx contrib/mainnet-mock-rpc/index.ts
```

## Running the Tests

```bash
npx vitest run contrib/mainnet-mock-rpc/index.test.ts
```
