// Issue #639 — two @stellar/stellar-sdk copies in one dependency tree.
//
// vellar-sdk peers on @stellar/stellar-sdk and passkey-kit pulls in its own
// range, so a consumer can end up with two physical copies. Classes such as
// Transaction, Address and Keypair are then distinct constructors, and any
// `instanceof` or constructor-argument check across the boundary fails.
// See README.md in this folder for the measured behaviour.

import { createRequire } from "node:module";

type StellarSdk = typeof import("@stellar/stellar-sdk");

/**
 * Load the CommonJS build of @stellar/stellar-sdk, including its own
 * stellar-base and js-xdr. The package under test imports the ESM build, so
 * this copy is a second, fully independent set of classes, the same situation
 * as two installs in one dependency tree.
 */
export function loadIsolatedStellarSdk(): StellarSdk {
  return createRequire(import.meta.url)("@stellar/stellar-sdk") as StellarSdk;
}

export class StellarSdkInstanceMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StellarSdkInstanceMismatchError";
  }
}

/**
 * Throw unless `value` is an instance of `ctor` from the same
 * @stellar/stellar-sdk copy. A value that has the right class name but fails
 * `instanceof` is the signature of a duplicate install and gets a dedicated
 * error; anything else is an ordinary TypeError.
 */
export function assertSameStellarSdkInstance<T>(
  value: unknown,
  ctor: abstract new (...args: never[]) => T,
  label: string,
): asserts value is T {
  if (value instanceof ctor) return;
  const actual = typeof value === "object" && value !== null ? value.constructor?.name : undefined;
  if (actual !== undefined && actual === ctor.name) {
    throw new StellarSdkInstanceMismatchError(
      `${label} is a ${ctor.name} from a different copy of @stellar/stellar-sdk than the one vellar-sdk uses. ` +
        "Your dependency tree has two copies of @stellar/stellar-sdk; run `npm ls @stellar/stellar-sdk`, " +
        "then `npm dedupe` or pin one version with `overrides`.",
    );
  }
  throw new TypeError(`${label} must be a ${ctor.name}, got ${actual ?? typeof value}.`);
}
