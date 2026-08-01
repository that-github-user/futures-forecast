/**
 * Unit tests for the pure rendering helpers on DCEventsTab.
 *
 * The IV-source helpers encode the "traffic-light" mapping from backend
 * `iv_source` values to color + tooltip. The outcome helpers map
 * `signal_events.outcome` to colour, label, and summary-chip membership.
 * Frontend has no integration test for the whole tab (DOM-heavy), but
 * these helpers are pure — pinning their contract catches any accidental
 * remap (e.g. someone swapping chain/vix colors during a refactor), and
 * pins the one piece of tab state that is hand-maintained rather than
 * derived from the data (SUMMARY_OUTCOMES).
 */

import { describe, expect, it } from "vitest";
import type { DCSignalEvent } from "../../api/dcTypes";
import {
  SUMMARY_OUTCOMES,
  isTradeWorthyEvent,
  ivSourceCellStyle,
  ivSourceTitle,
  labelFor,
  outcomeColor,
} from "./DCEventsTab";

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

describe("blocked_entries_disabled — the 2026-08-01 DC retirement state", () => {
  // This outcome became the tab's most common row when automated DC entry
  // was retired. Both helpers special-case it; these pin why.

  it("renders blue, NOT the muted grey used for skipped_signal", () => {
    // The distinction is the point: skipped_signal = no signal today,
    // blocked_entries_disabled = a GO/GO+ fired and we declined to trade
    // it. Collapsing them into one colour erases the research signal.
    expect(outcomeColor("blocked_entries_disabled")).toBe("#3b82f6");
    expect(outcomeColor("blocked_entries_disabled"))
      .not.toBe(outcomeColor("skipped_signal"));
  });

  it("is not coloured as any failure tier", () => {
    // It is a policy state, not an error — must not share a colour with
    // the amber soft-blocks or either red tier.
    const color = outcomeColor("blocked_entries_disabled");
    for (const failure of ["blocked_sl", "blocked_vix", "blocked_margin",
                           "blocked_risk", "blocked_order", "blocked_conn"]) {
      expect(color).not.toBe(outcomeColor(failure));
    }
  });

  it("gets a plain-language label, not the generic blk: transform", () => {
    expect(labelFor("blocked_entries_disabled")).toBe("not traded");
    expect(labelFor("blocked_entries_disabled")).not.toMatch(/blk:/);
  });

  it("leaves the generic transform intact for every other outcome", () => {
    // Guards against the special-case swallowing the general path.
    expect(labelFor("blocked_sl")).toBe("blk:sl");
    expect(labelFor("skipped_signal")).toBe("skipped signal");
    expect(labelFor("entered")).toBe("entered");
  });

  it("still degrades gracefully for a genuinely unknown outcome", () => {
    expect(outcomeColor("blocked_something_new")).toBe("#94a3b8");
    expect(labelFor("blocked_something_new")).toBe("blk:something new");
  });

  it("gets a summary chip", () => {
    // The original gap. Chips render from a hand-maintained list, and an
    // absent outcome is invisible in the summary even with rows in the
    // table — so the tab would have under-reported its now-most-common
    // event. Colour and label alone do not fix that; membership does.
    expect(SUMMARY_OUTCOMES).toContain("blocked_entries_disabled");
  });

  it("counts toward the SHOULD BE IN verdict", () => {
    // The operator's requirement: one binary, "should we be in this
    // position right now or not". This outcome is the retired-product
    // half of the yes side.
    expect(isTradeWorthyEvent({ outcome: "blocked_entries_disabled" })).toBe(true);
    expect(isTradeWorthyEvent({ outcome: "entered" })).toBe(true);
  });

  it("keeps every not-would-have-traded outcome on the NO side", () => {
    // blocked_order is the subtle one: the daemon DID attempt, so the card
    // lifecycle treats it as fired — but the broker never crossed, so we
    // are not in the position. The verdict must not claim we are.
    for (const outcome of ["blocked_order", "skipped_signal", "blocked_sl",
                           "blocked_vix", "blocked_margin", "blocked_direction",
                           "blocked_duplicate", "blocked_risk"]) {
      expect(isTradeWorthyEvent({ outcome })).toBe(false);
    }
  });

  it("blocked_direction also gets a chip", () => {
    // Found by review: the daemon emits this for credit-direction
    // strategies (engine/entry.py gate 0) and it was ALSO missing from
    // the list — the same defect, left behind while the list was being
    // extracted to prevent exactly it.
    expect(SUMMARY_OUTCOMES).toContain("blocked_direction");
  });

  it("is summarised ahead of the failure outcomes", () => {
    // Display order: it belongs next to `entered` as a headline count,
    // not buried among the block reasons.
    const idx = SUMMARY_OUTCOMES.indexOf("blocked_entries_disabled");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(SUMMARY_OUTCOMES.indexOf("blocked_sl"));
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
