# Deprecation pattern: legacy methods superseded by a newer client

Closes #300.

`src/payments.ts` currently exports pure types and amount-parsing helpers
(`parseTokenAmount`, `PaymentReview`) that `src/payments-client.ts`'s
`createPaymentClient` builds on — they aren't duplicated or superseded by
each other today. Rather than invent a deprecation for methods that aren't
actually redundant, this contrib entry documents the **reusable pattern** a
maintainer can apply directly to `payments.ts` (or any other module) the
moment a method there does get superseded by `payments-client.ts` or a
future client, without needing to design the mechanism from scratch each
time.

## The pattern

1. **JSDoc `@deprecated` tag** on the superseded method, naming its
   replacement by exact identifier so an IDE can link it, e.g.:

   ```ts
   /**
    * @deprecated Superseded by `PaymentClient.preparePayment()`. Will be
    * removed in the next major version — see CHANGELOG.md.
    */
   export function oldMethod() { ... }
   ```

2. **A one-time runtime warning**, via [`warnOnce`](deprecation-warning.ts),
   so callers who never see the JSDoc (compiled JS, no IDE hints) still get
   told. It fires once per process — not once per call — so a method called
   in a hot loop doesn't flood the console. See `legacySend` in
   [`deprecation-warning.ts`](deprecation-warning.ts) for the full
   call-site pattern.

3. **A CHANGELOG.md entry stating the removal timeline**, e.g. under an
   `## Unreleased` or the next version heading:

   ```md
   ### Deprecated
   - `oldMethod()` in `payments.ts` is deprecated in favor of
     `PaymentClient.preparePayment()` in `payments-client.ts`. It will
     continue to work through the current major version and be removed in
     the next major release. Migrate by replacing `oldMethod(a, b)` with
     `client.preparePayment({ ... })`.
   ```

   Because contributor changes are confined to `contrib/`, the actual
   `CHANGELOG.md` edit is left to a maintainer applying this pattern —
   this README shows the exact entry shape to add.

## Why a one-time warning, not every call

A method invoked once at startup and one invoked per-transaction both need
the same nudge, but logging on every call of a hot method would drown a
consuming app's own logs and make the warning look like a bug in itself.
[`warnOnce`](deprecation-warning.ts) tracks fired warnings by an id unique
to each deprecated method, in a module-level `Set`, so the cost of checking
"have I warned about this yet" is O(1) and the warning still reaches every
caller at least once per process.

## Run it

```sh
npx tsx deprecation-warning.ts
```

Expected output — the warning fires on the first call and is suppressed on
the second, even though `legacySend` still executes and returns a result
both times.

## Tests

```sh
npx vitest run contrib/examples/issue-300-deprecation-warning-pattern
```

Verifies: the warning fires exactly once per id, separate ids are tracked
independently, and the deprecated method's return value is unaffected by
the warning path.
