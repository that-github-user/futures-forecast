// @vitest-environment node

import { describe, expect, it } from "vitest";
import { classifyReentry, pnlColor } from "./reentryHelpers";
import { colors } from "../../../styles/tokens";

// Pinning the debit-vs-credit direction flip — the load-bearing semantic
// of the multi-entry re-entry preview. A naive refactor that always
// treats `previewNetDebit < paidDebit` as "better" would silently break
// credit-direction strategies (SPY straddles, short puts), making the
// dashboard tell traders that collecting LESS premium is a better entry.

describe("classifyReentry", () => {
  describe("debit spreads (DC default — we pay premium)", () => {
    it("lower preview = better re-entry (would pay less)", () => {
      expect(classifyReentry(5.10, 4.20, "debit")).toBe("better");
    });

    it("higher preview = worse re-entry (would pay more)", () => {
      expect(classifyReentry(5.10, 5.80, "debit")).toBe("worse");
    });

    it("equal-within-cent preview = same", () => {
      expect(classifyReentry(5.10, 5.105, "debit")).toBe("same");
      expect(classifyReentry(5.10, 5.10, "debit")).toBe("same");
    });
  });

  describe("credit spreads (SPY shorts / straddles — we collect premium)", () => {
    it("higher preview = better re-entry (would collect more)", () => {
      expect(classifyReentry(3.20, 3.80, "credit")).toBe("better");
    });

    it("lower preview = worse re-entry (would collect less)", () => {
      expect(classifyReentry(3.20, 2.50, "credit")).toBe("worse");
    });

    it("equal-within-cent preview = same", () => {
      expect(classifyReentry(3.20, 3.205, "credit")).toBe("same");
    });
  });

  describe("missing or invalid preview", () => {
    it("null preview returns null", () => {
      expect(classifyReentry(5.10, null, "debit")).toBeNull();
    });

    it("NaN preview returns null", () => {
      expect(classifyReentry(5.10, NaN, "debit")).toBeNull();
    });

    it("Infinity preview returns null", () => {
      expect(classifyReentry(5.10, Infinity, "debit")).toBeNull();
    });
  });
});

describe("pnlColor", () => {
  it("positive P&L reads as accent-green (in profit)", () => {
    expect(pnlColor(150)).toBe(colors.accentGreen);
    expect(pnlColor(1.5)).toBe(colors.accentGreen);
  });

  it("negative P&L reads as accent-red (loss)", () => {
    expect(pnlColor(-150)).toBe(colors.accentRed);
    expect(pnlColor(-1.5)).toBe(colors.accentRed);
  });

  it("near-zero P&L reads as muted (functionally flat)", () => {
    // Within $1 of breakeven — sub-tick noise on a DC. Don't paint it
    // as a directional move.
    expect(pnlColor(0)).toBe(colors.textMuted);
    expect(pnlColor(0.5)).toBe(colors.textMuted);
    expect(pnlColor(-0.99)).toBe(colors.textMuted);
  });
});
