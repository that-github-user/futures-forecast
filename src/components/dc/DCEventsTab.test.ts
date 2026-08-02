/**
 * Unit tests for the pure rendering helpers on DCEventsTab.
 *
 * The IV-source helpers encode the "traffic-light" mapping from backend
 * `iv_source` values to color + tooltip. The outcome helpers map
 * `signal_events.outcome` to colour and label. Frontend has no integration
 * test for the whole tab (DOM-heavy), but these helpers are pure — pinning
 * their contract catches any accidental remap (e.g. someone swapping
 * chain/vix colors during a refactor).
 *
 * The verdict axis moved out to `eventOutcomeClass.ts` and is pinned in
 * `eventOutcomeClass.test.ts`: `isTradeWorthyEvent` and the hand-maintained
 * `SUMMARY_OUTCOMES` whitelist are gone, replaced by `classifyOutcome` and a
 * chip list DERIVED from the data. What remains here is the mechanical axis
 * — which gate stopped it, and how badly — which is a different question
 * from "should we be in it" and keeps its own colours.
 */

import { describe, expect, it } from "vitest";
import type { DCSignalEvent } from "../../api/dcTypes";
import {
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

  it("renders indigo, NOT the muted grey used for skipped_signal", () => {
    // The distinction is the point: skipped_signal = no signal today,
    // blocked_entries_disabled = a GO/GO+ fired and we declined to trade
    // it. Collapsing them into one colour erases the research signal.
    // Indigo, not the earlier blue: it borrows its should-be-in CLASS
    // colour so the chip ties to the headline tile it feeds, and blue now
    // belongs to the active-chip border (a selected chip and this outcome
    // were previously the same hex).
    expect(outcomeColor("blocked_entries_disabled")).toBe("#6366f1");
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

  it("keeps blocked_order red even though it shares the should-be-in class", () => {
    // The two axes answer different questions and both answers are true:
    // the daemon went to market (class) AND the ladder exhausted with zero
    // fills (colour). Recolouring it to the class tint would erase the
    // 87.5% no-fill rate, which is the most actionable fact on the tab.
    expect(outcomeColor("blocked_order")).toBe("#ef4444");
    expect(outcomeColor("blocked_order"))
      .not.toBe(outcomeColor("blocked_entries_disabled"));
  });

  it("gets a plain-language label naming the cause, not the generic blk: transform", () => {
    // "entries off" rather than the earlier "not traded": with a SHOULD BE
    // IN tile now above the chip row, "not traded" answered a question
    // nobody asked and quietly contradicted it.
    expect(labelFor("blocked_entries_disabled")).toBe("entries off");
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

  // Chip MEMBERSHIP and the SHOULD BE IN verdict moved to
  // eventOutcomeClass.test.ts. Membership is no longer a property of this
  // file at all: the chip row derives from the outcomes present in the
  // data, so an outcome can be mis-ordered but can never go chip-less —
  // which is the defect the old whitelist kept reintroducing.
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
