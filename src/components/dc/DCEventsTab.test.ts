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
  // Hex values updated for the cool/slate palette restored site-wide.
  // The function's contract — chain/vix/default/null mapped to four
  // distinct colors — is unchanged; only the underlying hex shifts.
  it("chain renders green (positive)", () => {
    expect(ivSourceCellStyle("chain").color).toBe("#10b981");
  });
  it("vix renders amber (warn)", () => {
    expect(ivSourceCellStyle("vix").color).toBe("#f59e0b");
  });
  it("default renders red (negative)", () => {
    expect(ivSourceCellStyle("default").color).toBe("#ef4444");
  });
  it("null renders muted slate", () => {
    expect(ivSourceCellStyle(null).color).toBe("#64748b");
  });
  it("unknown value falls back to muted slate", () => {
    // Defensive: if the backend ever ships a new enum value we don't
    // know about, the style should degrade gracefully rather than
    // throw or pick a misleading color.
    const sneaky = "unknown" as unknown as Source;
    expect(ivSourceCellStyle(sneaky).color).toBe("#64748b");
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
