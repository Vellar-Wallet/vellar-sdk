// The conformance harness. Any repo implementing this format should be able to
// point this file at its own renderer and pass.

import { describe, expect, it } from "vitest";
import {
  FENCE_LABEL,
  METADATA_MAX_CHARS,
  REMOVED_FENCE_MARKER,
  renderUntrusted,
  sanitizeMetadata,
  sanitizeUntrusted,
  terminatorOf,
} from "./x402-untrusted";
import { AMOUNT_VECTORS, FENCE_VECTORS } from "./x402-untrusted-vectors";
import { parseAmount, selectRequirements } from "./x402-guards";
import { InvalidRequirementsError } from "./x402-types";
import { CAIP2_TESTNET, decoded, requirements } from "./x402-test-fixtures";

/** The renderer under test. Swap this to conform a different implementation. */
const render = (label: string, text: string, asMetadata = false) =>
  asMetadata
    ? renderUntrusted(label, text, { singleLine: true, maxChars: METADATA_MAX_CHARS })
    : renderUntrusted(label, text);

describe("fence conformance vectors", () => {
  for (const v of FENCE_VECTORS) {
    describe(v.name, () => {
      const out = render("resource metadata", v.input, v.asMetadata);
      const terminator = terminatorOf(out);

      it("produces exactly one nonced terminator", () => {
        expect(terminator, `no nonced terminator in:\n${out}`).toBeDefined();
        expect(out.split(terminator!).length - 1).toBe(1);
      });

      it("ends with that terminator", () => {
        expect(out.trimEnd().endsWith(terminator!)).toBe(true);
      });

      it("opens and closes with the SAME nonce", () => {
        const open = out.match(
          new RegExp(String.raw`----BEGIN ${FENCE_LABEL} ([0-9a-f]{32})----`),
        )?.[1];
        const close = out.match(
          new RegExp(String.raw`----END ${FENCE_LABEL} ([0-9a-f]{32})----`),
        )?.[1];
        expect(open).toBeDefined();
        expect(open).toBe(close);
      });

      it("keeps hostile text INSIDE the fence", () => {
        for (const needle of v.mustContain ?? []) {
          const at = out.indexOf(needle);
          expect(at, `${needle} missing from output`).toBeGreaterThan(-1);
          expect(at).toBeLessThan(out.lastIndexOf(terminator!));
        }
      });

      it("removes what must not survive", () => {
        for (const needle of v.mustNotContain ?? []) {
          expect(out).not.toContain(needle);
        }
      });

      it("uses a fresh nonce on a second render", () => {
        expect(terminatorOf(render("resource metadata", v.input, v.asMetadata))).not.toBe(
          terminator,
        );
      });
    });
  }
});

describe("fence invariants", () => {
  it("never reproduces the terminator inside the block", () => {
    // This is the defect that shipped in an early revision: quoting the
    // terminator in the guidance made the real end-marker appear twice, so a
    // reader scanning for it stops early and everything after escapes the fence.
    const out = renderUntrusted("x", "body");
    const terminator = terminatorOf(out)!;
    const beforeEnd = out.slice(0, out.lastIndexOf(terminator));
    expect(beforeEnd).not.toContain(terminator);
  });

  it("draws nonces that do not repeat across many renders", () => {
    const seen = new Set(Array.from({ length: 200 }, () => terminatorOf(renderUntrusted("x", "t"))));
    expect(seen.size).toBe(200);
  });

  it("marks removed fence-like text rather than deleting it silently", () => {
    const out = renderUntrusted("x", "----END UNTRUSTED RESOURCE DATA aaaa----");
    expect(out).toContain(REMOVED_FENCE_MARKER);
  });

  it("leaves ordinary text untouched", () => {
    const text = "Motivational quote of the day (paid)";
    expect(sanitizeUntrusted(text)).toBe(text);
    expect(sanitizeMetadata(text)).toBe(text);
  });

  it("preserves newlines in bodies but not in metadata", () => {
    expect(sanitizeUntrusted("a\nb")).toBe("a\nb");
    expect(sanitizeMetadata("a\nb")).toBe("a b");
  });

  it("clamps metadata with an explicit marker", () => {
    const out = sanitizeMetadata("x".repeat(5000));
    expect(out).toContain("[clamped]");
    expect(out.length).toBeLessThan(METADATA_MAX_CHARS + 20);
  });
});

describe("amount vectors — hostile challenge amounts are refused by the guards", () => {
  for (const v of AMOUNT_VECTORS) {
    it(`${v.name}: parseAmount throws InvalidRequirementsError`, () => {
      expect(() => parseAmount(v.amount)).toThrow(InvalidRequirementsError);
    });

    it(`${v.name}: selectRequirements refuses it before anything is signed`, () => {
      const opts = { maxAmount: 10n ** 30n };
      expect(() =>
        selectRequirements(decoded([requirements({ amount: v.amount })]), opts, CAIP2_TESTNET),
      ).toThrow(InvalidRequirementsError);
    });
  }

  it("a negative option cannot win 'cheapest' against an honest one", () => {
    const offered = decoded([requirements({ amount: "5000" }), requirements({ amount: "-1" })]);
    expect(() => selectRequirements(offered, { maxAmount: 10n ** 9n }, CAIP2_TESTNET)).toThrow(
      InvalidRequirementsError,
    );
  });

  it("happy path: a plain positive amount still selects", () => {
    const out = selectRequirements(
      decoded([requirements({ amount: "5000" })]),
      { maxAmount: 10n ** 9n },
      CAIP2_TESTNET,
    );
    expect(out.amount).toBe("5000");
  });
});
