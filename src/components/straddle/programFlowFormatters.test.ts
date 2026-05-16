/**
 * Tests for the pure program-flow formatters.
 *
 * Covers both the live-mode windowed filter AND the cold-start
 * next-session helpers added in #313 — operators want a Saturday view
 * to surface Monday's preview, not a generic "still loading" empty.
 */

import { describe, expect, test } from "vitest";
import type { ProgramFlowEvent } from "../../api/terminalTypes";
import {
  eventsOnDate,
  filterWindowed,
  formatNextSessionLabel,
  formatUpcomingTime,
  formatWindowDate,
  formatWindowTime,
  nextSessionDate,
} from "./programFlowFormatters";

const monday: ProgramFlowEvent = {
  name: "jepi_continuous",
  intensity: "continuous",
  window_start: "2026-05-18T09:30:00-04:00",
  window_end: "2026-05-18T16:00:00-04:00",
};
const mondayJepq: ProgramFlowEvent = {
  name: "jepq_continuous",
  intensity: "continuous",
  window_start: "2026-05-18T09:30:00-04:00",
  window_end: "2026-05-18T16:00:00-04:00",
};
const tuesday: ProgramFlowEvent = {
  name: "jepi_continuous",
  intensity: "continuous",
  window_start: "2026-05-19T09:30:00-04:00",
  window_end: "2026-05-19T16:00:00-04:00",
};
const xyldFriday: ProgramFlowEvent = {
  name: "xyld_monthly_roll",
  intensity: "windowed",
  window_start: "2026-06-19T11:30:00-04:00",
  window_end: "2026-06-19T13:30:00-04:00",
};
const jheqxQuarter: ProgramFlowEvent = {
  name: "jheqx_quarterly_roll",
  intensity: "windowed",
  window_start: "2026-06-30T09:30:00-04:00",
  window_end: "2026-06-30T16:00:00-04:00",
};

describe("filterWindowed", () => {
  test("retains XYLD and JHEQX, drops JEPI/JEPQ continuous", () => {
    const out = filterWindowed([monday, mondayJepq, xyldFriday, jheqxQuarter]);
    expect(out.map((e) => e.name)).toEqual([
      "xyld_monthly_roll",
      "jheqx_quarterly_roll",
    ]);
  });

  test("returns empty array when only continuous events present", () => {
    expect(filterWindowed([monday, mondayJepq, tuesday])).toEqual([]);
  });
});

describe("nextSessionDate", () => {
  test("returns yyyy-mm-dd of first upcoming entry", () => {
    expect(nextSessionDate([monday, tuesday, xyldFriday])).toBe("2026-05-18");
  });

  test("returns null on empty upcoming list", () => {
    expect(nextSessionDate([])).toBeNull();
  });

  test("respects backend sort order — uses upcoming[0] even if a later entry is earlier in wall-clock time", () => {
    // Backend guarantees ascending sort; we trust it. Synthesize an
    // out-of-order list to lock the "uses first entry, not min()" rule.
    const outOfOrder: ProgramFlowEvent[] = [tuesday, monday];
    expect(nextSessionDate(outOfOrder)).toBe("2026-05-19");
  });
});

describe("eventsOnDate", () => {
  test("filters to a single yyyy-mm-dd including continuous flows", () => {
    const out = eventsOnDate(
      [monday, mondayJepq, tuesday, xyldFriday],
      "2026-05-18",
    );
    expect(out).toEqual([monday, mondayJepq]);
  });

  test("returns empty when no event matches the date", () => {
    expect(eventsOnDate([xyldFriday], "2026-05-18")).toEqual([]);
  });
});

describe("formatNextSessionLabel", () => {
  test("formats 'Mon, May 18' for Monday 2026-05-18", () => {
    expect(formatNextSessionLabel("2026-05-18")).toBe("Mon, May 18");
  });

  test("formats 'Tue, May 19' for Tuesday 2026-05-19", () => {
    expect(formatNextSessionLabel("2026-05-19")).toBe("Tue, May 19");
  });

  test("returns input unchanged on malformed date", () => {
    expect(formatNextSessionLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("formatUpcomingTime (JHEQX date-only carve-out)", () => {
  test("returns em-dash for JHEQX quarterly rolls (date-only display)", () => {
    // JHEQX collar roll is a calendar-date event on a daily-NAV mutual
    // fund — no intraday auction. The previous "09:30 ET" rendering
    // misled operators into expecting an opening-bell flow.
    expect(formatUpcomingTime(jheqxQuarter)).toBe("—");
  });

  test("returns the wall-clock start time for XYLD monthly rolls", () => {
    // XYLD is a real ETF auction in 11:30-13:30 ET — keep showing it.
    expect(formatUpcomingTime(xyldFriday)).toBe("11:30 ET");
  });

  test("returns the wall-clock start time for continuous flows (JEPI/JEPQ)", () => {
    // Continuous flows render through this path in the cold-start
    // "next session preview" mode — they keep their 09:30 ET start.
    expect(formatUpcomingTime(monday)).toBe("09:30 ET");
    expect(formatUpcomingTime(mondayJepq)).toBe("09:30 ET");
  });
});

describe("formatWindowDate / formatWindowTime (regression)", () => {
  test("formatWindowDate slices the ISO yyyy-mm-dd portion to 'Mon DD'", () => {
    expect(formatWindowDate(monday.window_start)).toBe("May 18");
  });

  test("formatWindowTime returns 'HH:MM ET'", () => {
    expect(formatWindowTime(monday.window_start)).toBe("09:30 ET");
  });
});
