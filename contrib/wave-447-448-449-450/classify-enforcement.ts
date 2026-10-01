import type { PolicyTemplateInfo, Enforcement } from "../../src/policy-types";

// Issue #449: Surface policy template enforcement honestly in listTemplates output.
//
// A template whose enforcement is "none" provides no on-chain guarantee at all.
// This helper gives integrators one obvious call to classify a template, so no
// UI accidentally lists a non-enforced template beside a real policy-contract
// one with no visible distinction.

/** Whether a template's enforcement provides an on-chain guarantee. `false`
 * means the template is advisory only — a UI should surface the explanation so
 * the user knows no contract protects the account. */
export interface EnforcementClassification {
  chainEnforced: boolean;
  /** Empty when `chainEnforced` is true; a short, reusable explanation otherwise. */
  explanation: string;
}

/** Classify a template by whether its enforcement is on-chain. One obvious call
 * for every integrator, so nobody has to re-derive it from the union. */
export function classifyEnforcement(template: PolicyTemplateInfo): EnforcementClassification {
  switch (template.enforcement.kind) {
    case "policy-contract":
    case "signer-limits":
      return { chainEnforced: true, explanation: "" };
    case "none":
      return {
        chainEnforced: false,
        explanation: "This template provides no on-chain enforcement — the policy is advisory only.",
      };
    case "custom-contract-pending":
      return {
        chainEnforced: false,
        explanation: "This template requires a custom policy contract that is not yet available.",
      };
  }
}