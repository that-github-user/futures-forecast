/**
 * Unit tests for the pure filter helpers exported from DCTentTab.
 *
 * `filterTradesByDays` and `isTentRenderable` are the testable
 * surface — the rest of the tab is JSX wired to React state, which
 * this codebase doesn't have @testing-library/react setup for.
 * Pinning these two contracts catches regressions in the date-range
 * picker and the "can this trade be charted?" gate.
 */

import { describe, expect, it } from "vitest";
import type { DCTrade } from "../../api/dcTypes";
import {
  daysSinceExpiry,
  etTodayYYYYMMDD,
  filterTradesByDays,
  isTentRenderable,
  tentLifecycle,
} from "./dcTentTab.helpers";


function trade(overrides: Partial<DCTrade> = {}): DCTrade {
  return {
    id: 1,
    strategy_name: "T DC",
    signal: "GO",
    entry_date: "2026-04-01",
    close_date: "2026-04-10",
    entry_debit: 10,
    close_value: 11,
    pnl: 100,
    result: "win",
    close_reason: "profit_target",
    quantity: 1,
    put_strike: 5700,
    call_strike: 5900,
    front_exp: "20260405",
    back_exp: "20260501",
    ...overrides,
  };
}


describe("filterTradesByDays", () => {
  // Anchor `now` to a fixed date so the test is reproducible regardless
  // of CI clock.
  const now = new Date("2026-05-12T10:00:00-04:00");

  it("returns trades closed within the window", () => {
    const recent = trade({ id: 1, close_date: "2026-05-01" });   // 11 days back
    const old = trade({ id: 2, close_date: "2026-03-01" });      // 72 days back
    const out = filterTradesByDays([recent, old], 30, now);
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it("returns ALL trades when days <= 0 ('All' option)", () => {
    const recent = trade({ id: 1, close_date: "2026-05-01" });
    const old = trade({ id: 2, close_date: "2024-01-01" });
    expect(filterTradesByDays([recent, old], 0, now).length).toBe(2);
    expect(filterTradesByDays([recent, old], -1, now).length).toBe(2);
  });

  it("excludes trades with null close_date", () => {
    const dated = trade({ id: 1, close_date: "2026-05-01" });
    const undated = trade({ id: 2, close_date: null });
    const out = filterTradesByDays([dated, undated], 30, now);
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it("excludes trades with unparseable close_date", () => {
    const dated = trade({ id: 1, close_date: "2026-05-01" });
    const garbage = trade({ id: 2, close_date: "not-a-date" });
    const out = filterTradesByDays([dated, garbage], 30, now);
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it("uses inclusive boundary on the cutoff date (a trade exactly at the boundary qualifies)", () => {
    // 30 days before 2026-05-12 = 2026-04-12.
    const boundary = trade({ id: 1, close_date: "2026-04-12" });
    const out = filterTradesByDays([boundary], 30, now);
    expect(out.length).toBe(1);
  });
});


describe("isTentRenderable", () => {
  it("returns true when strikes + both expiries are present", () => {
    expect(isTentRenderable(trade())).toBe(true);
  });

  it("returns false when put_strike is missing", () => {
    expect(isTentRenderable(trade({ put_strike: null as unknown as undefined }))).toBe(false);
  });

  it("returns false when call_strike is missing", () => {
    expect(isTentRenderable(trade({ call_strike: null as unknown as undefined }))).toBe(false);
  });

  it("returns false when front_exp is missing", () => {
    expect(isTentRenderable(trade({ front_exp: null as unknown as undefined }))).toBe(false);
  });

  it("returns false when back_exp is missing", () => {
    expect(isTentRenderable(trade({ back_exp: null as unknown as undefined }))).toBe(false);
  });
});


describe("tentLifecycle", () => {
  // ET-today pinned via the YYYYMMDD string so the test is clock-stable.
  const today = "20260529";

  it("active when front_exp is in the future (both legs alive)", () => {
    expect(tentLifecycle({ front_exp: "20260603", back_exp: "20260604" }, today))
      .toBe("active");
  });

  it("front_expired when front settled but back still alive", () => {
    expect(tentLifecycle({ front_exp: "20260528", back_exp: "20260604" }, today))
      .toBe("front_expired");
  });

  it("settled when back_exp is in the past (fully dead — should be closed)", () => {
    // The "14d in on a 6/7-DTE" zombie: back leg expired days ago.
    expect(tentLifecycle({ front_exp: "20260514", back_exp: "20260515" }, today))
      .toBe("settled");
  });

  it("`>=` convention: a same-day front_exp is still active until EOD", () => {
    expect(tentLifecycle({ front_exp: today, back_exp: "20260604" }, today))
      .toBe("active");
  });

  it("`>=` convention: a same-day back_exp is NOT settled (in scope until EOD)", () => {
    expect(tentLifecycle({ front_exp: "20260528", back_exp: today }, today))
      .toBe("front_expired");
  });

  it("fails OPEN on missing/garbage expiries — never hides a position", () => {
    expect(tentLifecycle({ front_exp: null, back_exp: null }, today)).toBe("active");
    expect(tentLifecycle({ front_exp: "bad", back_exp: "also-bad" }, today)).toBe("active");
    expect(tentLifecycle({}, today)).toBe("active");
  });
});


describe("etTodayYYYYMMDD", () => {
  it("formats ET wall-clock as YYYYMMDD (no separators)", () => {
    // 2026-05-29 23:00 UTC = 19:00 ET on 2026-05-29.
    expect(etTodayYYYYMMDD(new Date("2026-05-29T23:00:00Z"))).toBe("20260529");
  });

  it("anchors in ET, not UTC: late-evening ET stays on the ET day", () => {
    // 2026-05-30 02:00 UTC = 2026-05-29 22:00 ET — still the 29th in ET.
    expect(etTodayYYYYMMDD(new Date("2026-05-30T02:00:00Z"))).toBe("20260529");
  });
});


describe("daysSinceExpiry", () => {
  const now = new Date("2026-05-29T15:00:00Z"); // 2026-05-29 in ET

  it("positive whole days for a past expiry", () => {
    expect(daysSinceExpiry("20260515", now)).toBe(14); // the zombie case
  });

  it("zero on today's expiry, negative for a future one", () => {
    expect(daysSinceExpiry("20260529", now)).toBe(0);
    expect(daysSinceExpiry("20260603", now)).toBe(-5);
  });

  it("null on a malformed expiry string", () => {
    expect(daysSinceExpiry("not-a-date", now)).toBeNull();
    expect(daysSinceExpiry("2026-05-15", now)).toBeNull(); // wrong format
  });
});
