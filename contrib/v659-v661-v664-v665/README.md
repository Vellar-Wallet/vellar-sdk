# x402 hardening: redirects, empty `accepts`, mid-signature session expiry, simulate timeout

Issues **#665**, **#661**, **#664**, **#659**.

Contributor PRs may only change `contrib/` (CONTRIBUTING.md rule 3). The issues name files in
`src/`, `website/` and `README.md`, so this folder follows the pattern of `contrib/v389-v386-v383-v390/`:

- **Tests:** they drive the **real, unmodified** `src/` modules.
- **Guards:** a small guard for each gap, usable today by passing it in through existing extension
  points (`fetchImpl`, the signer, the policy client).
- **Docs and integration steps:** the exact doc text and the `src/` changes for a maintainer to
  apply.

Run them:

```sh
npx vitest run contrib/v659-v661-v664-v665
```

`npm test` picks them up too (46 tests).

> **Heads-up: `dev` is currently red, independent of this PR.** Merge `7bcfdcf` left
> `src/x402-signer.ts` with a syntax error at line 237: the `/**` that opens the `capabilities`
> doc comment in `SessionKeySignerConfig` is missing. As a result, on a clean `dev`:
> - `npm run typecheck` fails;
> - `npm run build` fails with "DTS Build error";
> - `npm test` has 26 failing files, because every file that imports `x402-signer.ts` fails to load;
> - `check:docs` fails.
>
> The same merge also left **both** signers' `signAuthEntry` with two bodies. The second one, which
> is the only one calling `assertCapability`, is unreachable after the `try { … return } catch { throw }`.
> So **#224 capability scoping is not enforced on either signer.** See [Findings](#findings).

---

## #665: a seller redirecting the payment to a different host

**What happens today.** Both the probe and the paid retry go through `fetchImpl`, which defaults
to global `fetch` with `redirect: "follow"`. The fetch spec only strips `Authorization` on a
cross-origin redirect, and it forwards custom headers like `PAYMENT-SIGNATURE` to wherever
`Location` points.

`x402-redirect-guard.test.ts` proves this with Node's real `fetch` and two loopback servers:
- The seller answers the paid retry with `302 → <other origin>`.
- The signed payment arrives at the other origin.
- `createX402Client` still returns `paid: true`.

A redirected **probe** is worse: the client decodes a 402 from the attacker's host and pays *its*
terms.

**Decision: validate, don't blindly refuse.** Every redirect target is checked against the origin
(scheme + host + port) of the URL the caller asked for, which is the originally discovered resource.
- **Other origins are refused** with `X402CrossOriginRedirectError` before a byte is sent there. That
  includes `https→http` downgrades, sibling subdomains and protocol-relative `//host` locations.
- **Same-origin redirects** (`/paid` → `/paid/v2`) are followed by hand, with a hop limit
  (`X402TooManyRedirectsError`).
- **Opaque redirects are refused.** In browsers, `redirect: "manual"` yields an opaque response whose
  `Location` can't be read, so it can't be shown to be same-origin.
- **Why not refuse every redirect:** it would break legitimate same-origin moves (trailing slashes,
  versioned paths) for no security gain, since the signature is already scoped to the resource's
  origin.

**Use today:**

```ts
createX402Client({ ..., fetchImpl: createRedirectGuardedFetch() });
```

`createVellarWallet({ x402: { fetchImpl: createRedirectGuardedFetch() } })` works the same way.

**Adversarial vectors.** `x402-redirect-vectors.ts` exports `REDIRECT_VECTORS`, seven named vectors.
`post-402-cross-origin-redirect` is the canonical one, and `post-402-same-origin-redirect` is the
control that must be followed. Each vector is driven through the real client in the test.

**Proposed integration** (maintainer):
1. **`src/x402-client.ts`:** wrap `doFetch` with the guard's logic. That means
   `redirect: "manual"` plus the origin check, applied to both `doFetch(url, baseInit)` calls.
2. **`src/x402-types.ts`:** export `X402CrossOriginRedirectError` / `X402TooManyRedirectsError`.
3. **`src/x402-untrusted-vectors.ts`:** add `RedirectVector` and `REDIRECT_VECTORS` (verbatim from
   this folder). It's a transport vector, so it gets its own interface rather than reusing
   `FenceVector`.
4. **`src/x402-client.test.ts`:** move `x402-redirect-guard.test.ts` there. The RPC harness is in
   `test-helpers.ts`.
5. **`website/content/docs/architecture/threat-model.md`:** add this section after "Prompt injection
   in the MCP payer":

   > ## Redirects during payment
   >
   > A seller (A1) controls every response after the 402, including redirects. Because `fetch`
   > forwards custom headers such as `PAYMENT-SIGNATURE` across origins when it follows a redirect,
   > a seller could answer the paid retry with a redirect to a host it controls and receive the
   > signed payment there; redirecting the unpaid probe would make the client pay a different
   > seller's terms. The client therefore follows redirects itself and only to the origin (scheme,
   > host and port) of the resource it was asked to fetch. A redirect to any other origin — a
   > different host, a subdomain, or an `https` → `http` downgrade — fails with
   > `X402CrossOriginRedirectError` before anything is sent there. Same-origin redirects are
   > followed up to a small hop limit. In browsers, where a manual redirect hides its target, any
   > redirect during payment is refused.

---

## #661: the seller advertises zero payment schemes

**What happens today.** An **empty or missing** `accepts` already fails before anything is built or
signed, with `NoUsablePaymentOptionError("No exact/stellar:testnet payment option offered. Server
offered: (none)")`. A test pins this, along with "no signing, no simulation, no paid retry". It is
named, but it reads like a network mismatch.

**The gap.** `selectRequirements` uses `decoded.accepts ?? []`, which only covers `null` and
`undefined`. When `accepts` is an object or a string, `options.filter(...)` throws a raw
`TypeError: options.filter is not a function` from inside scheme matching, which is exactly the
confusing failure the issue describes. I verified this against the current code.

**Guard.** `NoPayableSchemeOfferedError` covers every "nothing payable was offered" shape: missing,
null, not an array, or empty. Its `received` field says which one.
- It extends `NoUsablePaymentOptionError`, so existing `catch` handlers keep working.
- `createAcceptsGuardedFetch()` checks the challenge as soon as the 402 arrives, so nothing is built,
  simulated or signed. The tests go through the real `createX402Facade`.

**Proposed integration:**
1. **`src/x402-guards.ts` `selectRequirements`:** replace `decoded.accepts ?? []` with
   `assertSchemesOffered(decoded)` from `x402-accepts-guard.ts`, then use `decoded.accepts`.
2. **`src/x402-types.ts`:** export `NoPayableSchemeOfferedError`.
3. **`src/x402-facade.test.ts`:** move `x402-facade-empty-accepts.test.ts` there.
4. **`website/content/docs/concepts/payment-loop.md`, under "Step 2: The seller responds 402 with
   terms":**

   > If the 402 offers no payment scheme at all — `accepts` missing, empty, or not a list — the
   > buyer stops here with `NoPayableSchemeOfferedError` (a `NoUsablePaymentOptionError`). Nothing
   > is simulated or signed and the request is not retried. This is a seller configuration problem:
   > the seller must list at least one `exact` option for the buyer's network.

---

## #664: the session expires while the payment is being signed

**What happens today.** Neither signer looks at the session. The only check is `resolveSigner` in
`client.ts`, which runs once before simulation. The passkey signer then awaits `webAuthn.sign()`, a
user prompt that can stay open indefinitely. If the session ends meanwhile (sign-out,
`sessionStore.end()`, idle expiry, or a switch to another wallet), the signature is returned and
the payment is submitted anyway.

**Expected behaviour (what the guard enforces):**
- **Before signing:** if there's no valid session for this signer's wallet, it is refused with
  `SessionInvalidatedDuringSigningError` (`phase: "before-signing"`), and the prompt never opens.
- **After signing:** the session is re-checked.
  - If it is no longer valid, it is discarded: `phase: "during-signing"`.
  - If it is valid but no longer the *same* session (signed out and back in, which changes
    `createdAt`, or switched wallet), it is also discarded.
  - A discarded signature never leaves `signAuthEntry`, so it is never submitted.
- **The ceremony itself can't be cancelled.** `WebAuthnAssertionSigner.sign()` takes no
  `AbortSignal`. Discarding is what guarantees the property; a signal would only make it faster.
- **A discarded signature is harmless.** It reached no one, and the entry expires on-chain within the
  signature-expiration window.

**Use today:**

```ts
withSessionGuard(signer, { getSession: sessionFromStore(store), maxIdleMs })
```

Tests use the real `src/session.ts` store, plus a passkey-shaped signer whose prompt the test
completes on demand. One test runs end to end through the real `createX402Client`.

> The real `createPasskeyX402Signer` can't be imported on `dev` today because of the syntax error
> above. The guard depends only on the `SmartAccountX402Signer` interface that both signers
> implement.

**Proposed integration:**
1. **`src/x402-signer.ts`**, in both signers: run the guard's before/after check around
   `webAuthn.sign()` / `keypair.sign()`.
   - Add a `getSession` option to `PasskeyX402SignerConfig` / `SessionKeySignerConfig`.
   - `client.ts` passes `() => session`.
   - Put this comment at the session check:

     ```ts
     // Session race (#664): the session is checked before signing AND re-checked after the
     // authenticator returns. If it ended, expired, or was replaced while the prompt was open,
     // the signature is discarded here and never returned, so a payment is never bound to a
     // session the SDK considers invalid. The ceremony itself cannot be aborted (no AbortSignal).
     ```
2. **`src/x402-signer.test.ts`:** move `x402-signer-session-guard.test.ts` there, swapping the
   double for the real `createPasskeyX402Signer` once that file compiles.
3. **`website/content/docs/architecture/threat-model.md`:** the risk isn't covered there today.
   Proposed bullet under "When it fails":

   > - **The session ends while a passkey prompt is open.** The signer re-checks the session after
   >   the passkey returns and discards the signature if the session ended, expired, or was
   >   replaced in the meantime; the payment is not submitted and
   >   `SessionInvalidatedDuringSigningError` is thrown.

---

## #659: policy simulate when the dry-run call times out

**What happens today.** `simulate` is one `fetch` to the gateway's `POST /policies/:id/simulate`,
which runs the Soroban simulation server-side, with no timeout or abort signal. A test shows it
stays pending through 10 minutes of fake time.
- Any transport throw is also re-wrapped as `PolicyApiError(…, 0)`. So an abort inside the fetch
  wouldn't be recognisable as a timeout.

**Guard.** `createPolicyClientWithSimulateTimeout({ ..., simulateTimeoutMs })` (default 30 s) races
`simulate` against its own timer, outside that wrapping.
- **Timer wins:** the in-flight request is aborted and the call rejects with
  `PolicySimulateTimeoutError` (`policyId`, `timeoutMs`).
- **A simulation failure** (`{ ok: false, error }`) is a real answer, and still **resolves**
  unchanged.
- **An HTTP error** is still a `PolicyApiError` with its real status.
- **Other methods** are the unmodified client.

**Proposed integration:**
1. **`src/policy-client.ts`:** add `simulateTimeoutMs` to `PolicyClientOptions` and apply the same
   race in `simulate`.
2. **`src/policy-facade.ts`:** pass it through, and export `PolicySimulateTimeoutError` from
   `src/policy-types.ts`.
3. **`src/policy-client.test.ts`:** move `policy-simulate-timeout.test.ts` there.
4. **`README.md`, in the policies section after the `simulate` example:**

   > `simulate()` is bounded by a timeout (default 30 s, `simulateTimeoutMs` to change it). If the
   > gateway — or the Soroban RPC behind it — doesn't answer in time, the request is aborted and
   > `simulate()` rejects with `PolicySimulateTimeoutError`. That is different from a simulation
   > that ran and failed, which resolves normally with `{ ok: false, error }`.

---

## Findings

Outside these four issues; no changes made.

1. **`dev` doesn't compile.** See the heads-up above. The fix is restoring the `/**` before the
   `capabilities` doc comment in `SessionKeySignerConfig` (around line 230).
2. **#224 capability scoping is dead code in both signers.** In `createSessionKeySigner` and
   `createPasskeyX402Signer`, the merge kept the audit-hook body (`try { …; return signed } catch {
   …; throw }`) *and* appended the capability body after it. The capability body is the only place
   `assertCapability` runs, and it is unreachable.
   - Configured `capabilities` are validated but never enforced.
   - `x402-signer-capabilities.test.ts` passes because it only tests `assertCapability` in
     isolation.
3. **A 3xx on the paid retry is reported as paid.** `x402Fetch` treats any status below 400 except
   402 as success. With a non-following `fetchImpl`, a seller's 302 yields `paid: true` with the
   redirect as the "unlocked" response. The redirect guard covers the redirect cases. Separately,
   it may be worth treating any non-2xx as "not paid".
