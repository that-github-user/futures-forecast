/**
 * Unit tests for the event-class axis — "should we be in this position?"
 *
 * Two things are pinned here and both are load-bearing. First the class
 * boundary itself: it follows the daemon's gate ORDERING — the two outcomes
 * raised below `_persist_and_submit`'s first gate-free line. It is
 * deliberately WIDER than the daemon's phantom-write predicate, which is a
 * string equality on `blocked_order` (`entry.py:1258`) and therefore drops
 * every post-retirement row. Getting this wrong in either direction makes
 * the Events tab and the Tent tab answer one question two ways — they did,
 * for one release: 14 "should be in" against 82 rendered "Missed Entries".
 *
 * Second, the COMPLETE outcome vocabulary. `engine/entry.py` is the sole
 * writer of `signal_events` and can emit exactly 16 strings; every one of
 * them gets its own assertion below, spelled out rather than looped. That
 * is the point — `classifyOutcome` defaults unknown strings to `no_trade`,
 * so a new daemon outcome would otherwise land in the safe bucket
 * permanently and silently. Breaking this file is how the next outcome
 * gets classified on purpose.
 */

import { describe, expect, it } from "vitest";
import {
  EVENT_CLASS_ORDER,
  OUTCOME_DISPLAY_ORDER,
  classifyOutcome,
  eventClassColor,
  eventClassLabel,
  eventClassTooltip,
  orderOutcomesForDisplay,
} from "./eventOutcomeClass";

describe("classifyOutcome — the IN class", () => {
  it("'entered' is the only outcome we actually hold", () => {
    // Backed one-for-one by a row in the positions table: 14 events, 14
    // positions on the 2026-04-20..2026-07-31 record.
    expect(classifyOutcome("entered")).toBe("in");
  });
});

describe("classifyOutcome — the SHOULD BE IN class", () => {
  // The boundary. Both of these are raised BELOW every evaluation gate in
  // engine/entry.py::attempt_entry. Only ONE of them also gets a
  // phantom_positions row — that writer is narrower on purpose-by-accident
  // (a string equality the daemon never widened), and following it here
  // would erase the post-retirement record entirely.

  it("blocked_order — the ladder ran and the market never crossed", () => {
    // entry.py:1082, inside _persist_and_submit, below the master switch.
    // The daemon committed and went to market; zero fills. 98 rows.
    expect(classifyOutcome("blocked_order")).toBe("should_be_in");
  });

  it("blocked_entries_disabled — the master switch, not a gate", () => {
    // entry.py:984. Sits above the first state mutation and below every
    // evaluation gate, so reaching it means the daemon WOULD have entered.
    expect(classifyOutcome("blocked_entries_disabled")).toBe("should_be_in");
  });

  it("the two are the same class, and it is not the IN class", () => {
    // They are mutually exclusive by config — with dc_entry.enabled false
    // blocked_order is unreachable — so only their UNION spans the
    // 2026-08-01 retirement boundary. And neither means we hold anything.
    expect(classifyOutcome("blocked_order"))
      .toBe(classifyOutcome("blocked_entries_disabled"));
    expect(classifyOutcome("blocked_order")).not.toBe(classifyOutcome("entered"));
  });
});

describe("classifyOutcome — the NO TRADE class", () => {
  it("covers every gate the daemon can fail before going to market", () => {
    // One assertion per outcome string, deliberately not a loop over
    // OUTCOME_DISPLAY_ORDER: the whole value of this block is that adding
    // a daemon outcome forces someone to type a line here and decide.
    expect(classifyOutcome("blocked_direction")).toBe("no_trade");   // entry.py:344
    expect(classifyOutcome("blocked_risk")).toBe("no_trade");        // :353
    expect(classifyOutcome("blocked_duplicate")).toBe("no_trade");   // :358 — already in, not should-be-in
    expect(classifyOutcome("skipped_signal")).toBe("no_trade");      // :376
    expect(classifyOutcome("blocked_conn")).toBe("no_trade");        // :406
    expect(classifyOutcome("blocked_data")).toBe("no_trade");        // :413/424/493/596/724/945
    expect(classifyOutcome("blocked_strike")).toBe("no_trade");      // :524
    expect(classifyOutcome("blocked_deconflict")).toBe("no_trade");  // :573
    expect(classifyOutcome("blocked_legs")).toBe("no_trade");        // :604
    expect(classifyOutcome("blocked_sl")).toBe("no_trade");          // :697/703
    expect(classifyOutcome("blocked_vix")).toBe("no_trade");         // :719
    expect(classifyOutcome("blocked_size")).toBe("no_trade");        // :744
    expect(classifyOutcome("blocked_margin")).toBe("no_trade");      // :758/774
  });

  it("takes unknown, garbage and empty strings — conservatively", () => {
    // The default direction is UNDER-claiming. An unrecognised string must
    // never inflate the should-be-in headline, because that number is what
    // the operator reconciles against real fills.
    expect(classifyOutcome("blocked_something_new")).toBe("no_trade");
    expect(classifyOutcome("ENTERED")).toBe("no_trade");
    expect(classifyOutcome("¯\\_(ツ)_/¯")).toBe("no_trade");
    expect(classifyOutcome("")).toBe("no_trade");
  });
});

describe("OUTCOME_DISPLAY_ORDER — the known vocabulary", () => {
  it("holds all 16 outcome strings engine/entry.py can emit", () => {
    // entry.py is the only writer of signal_events (state/store.py:1610 is
    // its only INSERT, called from entry.py:263 alone). If that count moves,
    // the daemon gained or lost an outcome and both this list and
    // classifyOutcome need the new member.
    expect(OUTCOME_DISPLAY_ORDER).toHaveLength(16);
    expect(new Set(OUTCOME_DISPLAY_ORDER).size).toBe(16);
  });

  it("leads with the classes that reached the market", () => {
    // The chip row is a refinement of the class row above it, so it groups
    // by class first: the fill, then the two that went to market and didn't.
    expect(OUTCOME_DISPLAY_ORDER.slice(0, 3))
      .toEqual(["entered", "blocked_order", "blocked_entries_disabled"]);
  });

  it("still summarises blocked_entries_disabled ahead of the failure gates", () => {
    // Carried over from the SUMMARY_OUTCOMES era: it belongs next to
    // `entered` as a headline count, not buried among the block reasons.
    expect(OUTCOME_DISPLAY_ORDER.indexOf("blocked_entries_disabled"))
      .toBeLessThan(OUTCOME_DISPLAY_ORDER.indexOf("blocked_sl"));
  });

  it("classifies every member — no outcome falls through by accident", () => {
    for (const outcome of OUTCOME_DISPLAY_ORDER) {
      expect(EVENT_CLASS_ORDER).toContain(classifyOutcome(outcome));
    }
  });
});

describe("orderOutcomesForDisplay", () => {
  it("sorts present outcomes into canonical order", () => {
    expect(orderOutcomesForDisplay(["blocked_sl", "entered", "blocked_order"]))
      .toEqual(["entered", "blocked_order", "blocked_sl"]);
  });

  it("KEEPS an unknown outcome, appended at the end", () => {
    // The regression this function exists for. The old chip row mapped a
    // hand-maintained whitelist, so an outcome missing from it rendered no
    // chip at all while its rows sat in the table below — which is how
    // blocked_entries_disabled and blocked_direction were both invisible.
    // Mis-ordered is survivable; vanished is not.
    expect(orderOutcomesForDisplay(["blocked_from_the_future", "entered"]))
      .toEqual(["entered", "blocked_from_the_future"]);
  });

  it("de-duplicates and sorts multiple unknowns stably", () => {
    expect(orderOutcomesForDisplay(["zeta", "entered", "alpha", "entered"]))
      .toEqual(["entered", "alpha", "zeta"]);
  });

  it("returns an empty list for no input", () => {
    expect(orderOutcomesForDisplay([])).toEqual([]);
  });
});

describe("EVENT_CLASS_ORDER", () => {
  it("covers every EventClass exactly once", () => {
    expect(EVENT_CLASS_ORDER).toEqual(["in", "should_be_in", "no_trade"]);
    expect(new Set(EVENT_CLASS_ORDER).size).toBe(EVENT_CLASS_ORDER.length);
  });
});

describe("eventClassColor", () => {
  // Raw hex, matching the house convention of pinning the value rather
  // than the token — a repointed token is exactly the change worth seeing.
  it("in renders green (the fill)", () => {
    expect(eventClassColor("in")).toBe("#10b981");
  });
  it("should_be_in renders indigo — off the severity ramp on purpose", () => {
    // accentIndigo had zero consumers under components/dc/. It must not be
    // any tier of outcomeColor's failure gradient: a should-be-in play is
    // not an error, it is a play the system called.
    expect(eventClassColor("should_be_in")).toBe("#6366f1");
  });
  it("no_trade renders the DC muted slate", () => {
    expect(eventClassColor("no_trade")).toBe("#64748b");
  });
  it("returns three distinct colours", () => {
    const seen = EVENT_CLASS_ORDER.map(eventClassColor);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("eventClassLabel", () => {
  it("names each class in the operator's words", () => {
    expect(eventClassLabel("in")).toBe("IN");
    expect(eventClassLabel("should_be_in")).toBe("SHOULD BE IN");
    expect(eventClassLabel("no_trade")).toBe("NO TRADE");
  });
});

describe("eventClassTooltip", () => {
  it("in is a count of FILLS, never of open risk", () => {
    // The tile renders a 22px green number under the word IN, which reads
    // as live inventory. It is not: all 14 positions on the current record
    // are terminal (12 closed, 2 cancelled) and /dc-api/v1/positions filters
    // `status IN ('open','partial')`, so the Positions tab is empty beside
    // it. The copy has to break that tie or the two tabs contradict.
    const t = eventClassTooltip("in");
    expect(t).toMatch(/NOT live inventory/i);
    expect(t).toMatch(/Positions tab/);
  });

  it("in does not claim every counted row is still a good fill", () => {
    // 2 of the 14 were cancelled as `pre-fix-ghost` — the daemon recorded
    // a fill that never existed. "The daemon got the order done" was not
    // uniformly true of the rows this tile counts.
    expect(eventClassTooltip("in")).toMatch(/ghost fills/i);
  });

  it("should_be_in is explicit that we are NOT in these", () => {
    // The honesty requirement. This class exists to surface plays the
    // system called; the copy must not let it read as ownership.
    expect(eventClassTooltip("should_be_in")).toMatch(/NOT in/);
    expect(eventClassTooltip("should_be_in")).toMatch(/ladder exhausted/i);
  });

  it("should_be_in tracks which outcomes actually carry a phantom", () => {
    // THE cross-tab correctness test, and it has now fired twice for
    // opposite reasons — which is the point of pinning copy against a
    // daemon-side fact rather than against prose someone liked.
    //
    // Round 1: the daemon matched `blocked.outcome == 'blocked_order'`,
    // so `blocked_entries_disabled` wrote no phantom. Copy claiming
    // otherwise sent the operator to a Missed Entries panel that would
    // never gain another card.
    //
    // Round 2 (now): the daemon widened that to PHANTOM_WORTHY_OUTCOMES,
    // so entries-off rows DO carry a phantom with a full through-expiry
    // curve. The round-1 wording — "entries-off rows have no phantom and
    // no through-expiry P&L, so this tab is their whole record" — became
    // false the moment that shipped, and this assertion is what caught
    // it. Keep asserting the CURRENT daemon behavior, not the phrasing.
    const t = eventClassTooltip("should_be_in");
    expect(t).toMatch(/BOTH endings now carry a phantom/);
    expect(t).toMatch(/Tent tab/);
    expect(t).toMatch(/Missed Entries/);
    // The two falsified claims from round 1 must never come back.
    expect(t).not.toMatch(/Only the ladder rows carry a phantom/);
    expect(t).not.toMatch(/entries-off rows have no phantom/);
    expect(t).not.toMatch(/from 2026-05-15 onward/);
  });

  it("should_be_in states the entries-off recording semantics", () => {
    // Two properties an operator will otherwise infer wrongly from a
    // Missed Entries card, both introduced alongside the widened
    // predicate: the row is unit sized (the D'Alembert multiplier is
    // frozen with no fills feeding it, so recording it would dress a
    // stale constant up as a sizing decision), and it is written once
    // per would-be holding period rather than once per evaluation slot
    // (with entries off the duplicate gate can never fire, so without
    // that rule one intended position multiplies into one row per day).
    const t = eventClassTooltip("should_be_in");
    expect(t).toMatch(/unit sized/);
    expect(t).toMatch(/holding period/);
  });

  it("should_be_in does not claim an order was sent for both endings", () => {
    // `blocked_entries_disabled` never reaches the ladder — the master
    // switch at entry.py:984 sits ABOVE it — so a blanket "the daemon went
    // to market" is false for the only outcome this class still receives.
    const t = eventClassTooltip("should_be_in");
    expect(t).toMatch(/no order was ever sent/);
  });

  it("no_trade says nothing reached the market", () => {
    expect(eventClassTooltip("no_trade")).toMatch(/reached the market/i);
  });
});
