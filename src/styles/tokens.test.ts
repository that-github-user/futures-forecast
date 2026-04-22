// @vitest-environment node

import { describe, expect, it } from "vitest";
import { colors, fonts, withAlpha, withAlphaByte } from "./tokens";

describe("withAlpha", () => {
  it("appends 00 for alpha 0", () => {
    expect(withAlpha(colors.accentGreen, 0)).toBe("#10b98100");
  });

  it("appends ff for alpha 1", () => {
    expect(withAlpha(colors.accentGreen, 1)).toBe("#10b981ff");
  });

  it("appends 40 for alpha 0.25 (documented example)", () => {
    // The audit-era inline literal was `#10b98140` — make sure the
    // helper reproduces it exactly so the visual doesn't shift.
    expect(withAlpha(colors.accentGreen, 0.25)).toBe("#10b98140");
  });

  it("appends 80 for alpha 0.5", () => {
    expect(withAlpha(colors.accentBlue, 0.5)).toBe("#3b82f680");
  });

  it("clamps negative alpha to 0", () => {
    expect(withAlpha(colors.accentRed, -0.5)).toBe("#ef444400");
  });

  it("clamps alpha >1 to 1", () => {
    expect(withAlpha(colors.accentRed, 2)).toBe("#ef4444ff");
  });

  it("reproduces the subtle-tint variants used in strategy card", () => {
    // Spot-check a handful of round-fraction variants used in the
    // lifecycle-state theming.
    expect(withAlpha(colors.accentAmber, 0.25)).toBe("#f59e0b40");
    expect(withAlpha(colors.accentGreen, 0.6)).toBe("#10b98199");
    expect(withAlpha(colors.accentGreen, 0.8)).toBe("#10b981cc");
  });
});

describe("withAlphaByte", () => {
  it("appends exact byte as two-digit hex", () => {
    expect(withAlphaByte(colors.accentGreen, 0x44)).toBe("#10b98144");
    expect(withAlphaByte(colors.accentGreen, 0x28)).toBe("#10b98128");
    expect(withAlphaByte(colors.accentGreen, 0x18)).toBe("#10b98118");
  });

  it("clamps below 0", () => {
    expect(withAlphaByte(colors.accentRed, -5)).toBe("#ef444400");
  });

  it("clamps above 255", () => {
    expect(withAlphaByte(colors.accentRed, 300)).toBe("#ef4444ff");
  });

  it("rounds fractional bytes", () => {
    expect(withAlphaByte(colors.accentRed, 127.6)).toBe("#ef444480");
  });
});

describe("token shape", () => {
  it("exposes the core palette", () => {
    // Canary: if a field is renamed, consumers break at compile time,
    // but if it's deleted this catches it at test time.
    expect(colors.bgBase).toBe("#0a0e17");
    expect(colors.textPrimary).toBe("#e2e8f0");
    expect(colors.accentGreen).toBe("#10b981");
    expect(fonts.sans).toMatch(/Inter/);
    expect(fonts.mono).toMatch(/JetBrains/);
  });
});
