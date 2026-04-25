// @vitest-environment node

import { describe, expect, it } from "vitest";
import { colors, fonts, withAlpha, withAlphaByte } from "./tokens";

// Hex literals updated for the LUMEN palette (PR #61). The helpers'
// behavior is unchanged; only the hex values they consume/produce
// shift to the new color tokens.

describe("withAlpha", () => {
  it("appends 00 for alpha 0", () => {
    expect(withAlpha(colors.accentGreen, 0)).toBe("#d6c79a00");
  });

  it("appends ff for alpha 1", () => {
    expect(withAlpha(colors.accentGreen, 1)).toBe("#d6c79aff");
  });

  it("appends 40 for alpha 0.25", () => {
    expect(withAlpha(colors.accentGreen, 0.25)).toBe("#d6c79a40");
  });

  it("appends 80 for alpha 0.5", () => {
    expect(withAlpha(colors.accentBlue, 0.5)).toBe("#efc88b80");
  });

  it("clamps negative alpha to 0", () => {
    expect(withAlpha(colors.accentRed, -0.5)).toBe("#b8746a00");
  });

  it("clamps alpha >1 to 1", () => {
    expect(withAlpha(colors.accentRed, 2)).toBe("#b8746aff");
  });

  it("reproduces the subtle-tint variants used in strategy card", () => {
    // Spot-check a handful of round-fraction variants used in the
    // lifecycle-state theming.
    expect(withAlpha(colors.accentAmber, 0.25)).toBe("#cf985240");
    expect(withAlpha(colors.accentGreen, 0.6)).toBe("#d6c79a99");
    expect(withAlpha(colors.accentGreen, 0.8)).toBe("#d6c79acc");
  });
});

describe("withAlphaByte", () => {
  it("appends exact byte as two-digit hex", () => {
    expect(withAlphaByte(colors.accentGreen, 0x44)).toBe("#d6c79a44");
    expect(withAlphaByte(colors.accentGreen, 0x28)).toBe("#d6c79a28");
    expect(withAlphaByte(colors.accentGreen, 0x18)).toBe("#d6c79a18");
  });

  it("clamps below 0", () => {
    expect(withAlphaByte(colors.accentRed, -5)).toBe("#b8746a00");
  });

  it("clamps above 255", () => {
    expect(withAlphaByte(colors.accentRed, 300)).toBe("#b8746aff");
  });

  it("rounds fractional bytes", () => {
    expect(withAlphaByte(colors.accentRed, 127.6)).toBe("#b8746a80");
  });
});

describe("token shape", () => {
  it("exposes the core palette", () => {
    // Canary: if a field is renamed, consumers break at compile time,
    // but if it's deleted this catches it at test time.
    expect(colors.bgBase).toBe("#0d0c0a");
    expect(colors.textPrimary).toBe("#f5efe2");
    expect(colors.accentGreen).toBe("#d6c79a");
    expect(colors.accentBlue).toBe("#efc88b");
    expect(colors.accentAmber).toBe("#cf9852");
    expect(fonts.sans).toMatch(/Inter/);
    expect(fonts.mono).toMatch(/JetBrains/);
  });
});
