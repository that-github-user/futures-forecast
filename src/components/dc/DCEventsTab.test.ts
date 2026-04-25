/**
 * Unit tests for the pure IV-source rendering helpers on DCEventsTab.
 *
 * The helpers encode the "traffic-light" mapping from backend
 * `iv_source` values to color + tooltip. Frontend has no integration
 * test for the whole tab (DOM-heavy), but these helpers are pure —
 * pinning their contract catches any accidental remap (e.g. someone
 * swapping chain/vix colors during a refactor).
 */

import { describe, expect, it } from "vitest";
import type { DCSignalEvent } from "../../api/dcTypes";
import { ivSourceCellStyle, ivSourceTitle } from "./DCEventsTab";

type Source = DCSignalEvent["iv_source"];

describe("ivSourceCellStyle", () => {
  // Hex values updated for the LUMEN palette (PR #61). The function's
  // contract — chain/vix/default/null mapped to four distinct colors —
  // is unchanged; only the underlying hex literals shift.
  it("chain renders cream (positive)", () => {
    expect(ivSourceCellStyle("chain").color).toBe("#d6c79a");
  });
  it("vix renders burnt amber (warn)", () => {
    expect(ivSourceCellStyle("vix").color).toBe("#cf9852");
  });
  it("default renders persimmon (negative)", () => {
    expect(ivSourceCellStyle("default").color).toBe("#b8746a");
  });
  it("null renders graphite (muted)", () => {
    expect(ivSourceCellStyle(null).color).toBe("#8c877c");
  });
  it("unknown value falls back to graphite", () => {
    // Defensive: if the backend ever ships a new enum value we don't
    // know about, the style should degrade gracefully rather than
    // throw or pick a misleading color.
    const sneaky = "unknown" as unknown as Source;
    expect(ivSourceCellStyle(sneaky).color).toBe("#8c877c");
  });
});

describe("ivSourceTitle", () => {
  it("chain describes the good path", () => {
    expect(ivSourceTitle("chain")).toMatch(/good path/i);
  });
  it("vix explicitly names the 21/28 incident", () => {
    // Future-self regression anchor: if the incident context is
    // removed from the tooltip, an operator might not understand why
    // amber is bad.
    expect(ivSourceTitle("vix")).toMatch(/21\/28/);
    expect(ivSourceTitle("vix")).toMatch(/fell back/i);
  });
  it("default names cold-start or refresh failure", () => {
    expect(ivSourceTitle("default")).toMatch(/cold-start|refresh failure/i);
  });
  it("null returns a fallback message", () => {
    expect(ivSourceTitle(null)).toMatch(/no resolve|predates/i);
  });
});
