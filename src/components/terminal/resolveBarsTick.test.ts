/**
 * Regression tests for resolveBarsTick (PR #253 review round 2):
 * fetch FAILURE (null) must stay distinct from a legitimate empty
 * payload — a failure over a warm chart keeps the candles WITH the
 * CACHED badge forced on (never frozen-but-looks-live), while a
 * server-authoritative empty payload replaces (honest "No bars
 * available", e.g. day rollover / cold IBKR start).
 */
import { describe, expect, it } from "vitest";
import { resolveBarsTick } from "./chartHelpers";
import type { TerminalIntradayBar } from "../../api/terminalClient";

const bar = (t: string): TerminalIntradayBar => ({
  time: t, open: 1, high: 2, low: 1, close: 2, volume: 10,
});

describe("resolveBarsTick", () => {
  it("applies a normal payload verbatim with its stale/age fields", () => {
    const payload = { bars: [bar("a")], stale: true, data_age_seconds: 42 };
    expect(resolveBarsTick(null, payload)).toEqual({
      kind: "apply", bars: payload.bars, stale: true, dataAgeSeconds: 42,
    });
  });

  it("defaults stale/age to fresh when an older backend omits them", () => {
    expect(resolveBarsTick(null, { bars: [bar("a")] })).toEqual({
      kind: "apply", bars: [bar("a")], stale: false, dataAgeSeconds: null,
    });
  });

  it("legit empty payload REPLACES a warm chart (honest empty state)", () => {
    const action = resolveBarsTick([bar("a")], { bars: [] });
    expect(action.kind).toBe("apply");
    expect(action).toMatchObject({ bars: [] });
  });

  it("failure over a warm chart keeps candles and forces the badge", () => {
    expect(resolveBarsTick([bar("a")], null)).toEqual({ kind: "offline-warm" });
  });

  it("failure with nothing to show is offline-cold (never wedge Loading)", () => {
    expect(resolveBarsTick(null, null)).toEqual({ kind: "offline-cold" });
    expect(resolveBarsTick([], null)).toEqual({ kind: "offline-cold" });
  });
});
