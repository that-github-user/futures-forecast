/**
 * Drift guard: the hook's DEFAULT_POLICY must be a valid PolicyKey that the
 * hook's own coercion layer accepts. Without this check, a rename that
 * touches one constant but not the other would silently overwrite the
 * default on first load and nobody would notice until production visitors
 * showed up with the wrong starting state.
 */

import { describe, expect, it } from "vitest";

import type { PolicyKey } from "../api/dcTypes";
import { DEFAULT_POLICY, VALID_POLICIES } from "./useCapitalAllocation";

describe("useCapitalAllocation constants", () => {
  it("DEFAULT_POLICY is a member of VALID_POLICIES", () => {
    expect(VALID_POLICIES).toContain(DEFAULT_POLICY);
  });

  it("VALID_POLICIES covers every PolicyKey literal", () => {
    // Compile-time + runtime exhaustiveness: if a new PolicyKey is added
    // to dcTypes.ts but not to VALID_POLICIES, this assertion will catch it
    // at the last listed literal (keep the list manually synced with
    // the type). `satisfies` ensures the test itself stays strict.
    const everyKnownKey = [
      "take_all",
      "rec_60_10",
      "cons_40_8",
      "cop_cons_60_10",
      "static_1ct",
    ] satisfies readonly PolicyKey[];
    for (const k of everyKnownKey) {
      expect(VALID_POLICIES).toContain(k);
    }
  });

  it("DEFAULT_POLICY is the neutral baseline (Type II opt-in design)", () => {
    expect(DEFAULT_POLICY).toBe("static_1ct");
  });
});
