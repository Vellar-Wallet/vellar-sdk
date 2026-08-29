# Wallet onboarding checklist runner

Walks through a fixed sequence of onboarding steps against mocked
dependencies, tracking which steps are complete after each run.
`runOnboardingChecklist()` runs steps **in order**, stops at the first
failure, and reports both `completed` and `remaining` (the failed step and
everything after it) so a caller can show progress even on a partial run.

## The steps

`buildMockChecklist()` builds the standard four-step checklist, in order:

1. **create-wallet** — register a passkey and create the smart account.
2. **fund-account** — sponsor-fund the new account so it can pay fees.
3. **verify-balance** — confirm the funded balance actually landed.
4. **attach-policy** — attach a default spending-limit policy.

Each step operates on shared mock state (an in-closure account id, balance,
and policy flag) standing in for a real wallet/backend round trip — no
network calls.

## Run it

```sh
npx tsx onboarding-checklist-runner.ts
```

Expected output:

```
Running 4 onboarding steps: create-wallet -> fund-account -> verify-balance -> attach-policy

Completed: [ 'create-wallet', 'fund-account', 'verify-balance', 'attach-policy' ]
Remaining: (none — onboarding complete)
```

## Tests

Covers the full checklist completing, and a partial run where a step fails
partway through:

```sh
npx vitest run contrib/examples/onboarding-checklist-runner
```
