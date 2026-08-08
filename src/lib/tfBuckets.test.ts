import { describe, expect, it } from "vitest";
import type { TerminalIntradayBar } from "../api/terminalTypes";
import {
  TF_SECONDS,
  barsCoverageEndSec,
  floorEpochSec,
  foldToGrid,
  liveBucketDraw,
  mergeBoundaryBucket,
  type FetchedTail,
  type LiveCandle,
} from "./tfBuckets";

const utc = (hms: string): number => Date.parse(`2026-06-16T${hms}Z`) / 1000;

/** One 1-minute bar as the review endpoint serves it. */
const bar = (
  hms: string,
  o: number,
  h: number,
  l: number,
  c: number,
  v = 0,
): TerminalIntradayBar => ({
  time: `2026-06-16T${hms}Z`,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

describe("floorEpochSec", () => {
  it("1m and 5m grids, exact on the boundary", () => {
    expect(floorEpochSec(utc("13:36:46"), "1m")).toBe(utc("13:36:00"));
    expect(floorEpochSec(utc("13:36:00"), "1m")).toBe(utc("13:36:00"));
    expect(floorEpochSec(utc("13:36:46"), "5m")).toBe(utc("13:35:00"));
    expect(floorEpochSec(utc("13:35:00"), "5m")).toBe(utc("13:35:00"));
    expect(floorEpochSec(utc("13:39:59"), "5m")).toBe(utc("13:35:00"));
    expect(floorEpochSec(utc("13:40:00"), "5m")).toBe(utc("13:40:00"));
  });

  it("reproduces the server's `epoch - epoch % tf_s` bit-for-bit", () => {
    for (let s = utc("13:30:00"); s < utc("13:45:00"); s += 7) {
      expect(floorEpochSec(s, "5m")).toBe(s - (s % 300));
      expect(floorEpochSec(s, "1m")).toBe(s - (s % 60));
    }
  });

  it("every 5m grid point is also a 1m grid point (markers never leave the grid)", () => {
    expect(TF_SECONDS["5m"] % TF_SECONDS["1m"]).toBe(0);
  });
});

describe("foldToGrid", () => {
  it("tf=1m returns the input BY IDENTITY — the default path is untouched", () => {
    const bars = [bar("13:35:00", 1, 2, 0.5, 1.5)];
    expect(foldToGrid(bars, "1m")).toBe(bars);
  });

  it("folds five 1-min bars into one bucket: first open, max high, min low, last close, summed volume", () => {
    const bars = [
      bar("13:35:00", 100, 103, 99, 102, 5),
      bar("13:36:00", 102, 110, 101, 108, 7),
      bar("13:37:00", 108, 109, 95, 96, 3),
      bar("13:38:00", 96, 104, 96, 103, 1),
      bar("13:39:00", 103, 105, 102, 104, 4),
    ];
    expect(foldToGrid(bars, "5m")).toEqual([
      {
        time: "2026-06-16T13:35:00.000Z",
        open: 100,
        high: 110,
        low: 95,
        close: 104,
        volume: 20,
      },
    ]);
  });

  it("does not mutate the input bars", () => {
    const bars = [bar("13:35:00", 100, 103, 99, 102, 5), bar("13:36:00", 102, 110, 101, 108, 7)];
    const snapshot = JSON.parse(JSON.stringify(bars));
    foldToGrid(bars, "5m");
    expect(bars).toEqual(snapshot);
  });

  it("never synthesizes a bucket across a halt or a feed gap", () => {
    // 13:37 → 13:50 is a 13-minute hole covering the 13:40 and 13:45 buckets.
    // A flat synthesized candle there would be indistinguishable from a real
    // unchanged bar, which is the one reading this pane must not fabricate.
    const out = foldToGrid(
      [
        bar("13:35:00", 100, 101, 99, 100),
        bar("13:36:00", 100, 102, 100, 101),
        bar("13:50:00", 90, 91, 89, 90),
        bar("13:51:00", 90, 93, 90, 92),
      ],
      "5m",
    );
    expect(out.map((b) => b.time)).toEqual([
      "2026-06-16T13:35:00.000Z",
      "2026-06-16T13:50:00.000Z",
    ]);
  });

  it("emits the PARTIAL trailing bucket", () => {
    const out = foldToGrid(
      [
        bar("13:35:00", 100, 101, 99, 100),
        bar("13:36:00", 100, 102, 100, 101),
        bar("13:37:00", 101, 103, 101, 102),
        bar("13:38:00", 102, 104, 102, 103),
        bar("13:39:00", 103, 105, 103, 104),
        bar("13:40:00", 104, 106, 104, 105),
        bar("13:41:00", 105, 107, 100, 101),
      ],
      "5m",
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      time: "2026-06-16T13:40:00.000Z",
      open: 104,
      high: 107,
      low: 100,
      close: 101,
      volume: 0,
    });
  });

  it("is a function of the bar SET — an out-of-order payload cannot invert a body", () => {
    const bars = [
      bar("13:35:00", 100, 103, 99, 102),
      bar("13:36:00", 102, 110, 101, 108),
      bar("13:37:00", 108, 109, 95, 96),
    ];
    expect(foldToGrid([...bars].reverse(), "5m")).toEqual(foldToGrid(bars, "5m"));
  });

  it("drops a bar whose timestamp won't parse rather than NaN-keying a bucket", () => {
    const out = foldToGrid(
      [
        { time: "not-a-date", open: 1, high: 1, low: 1, close: 1, volume: 0 },
        bar("13:35:00", 100, 101, 99, 100),
      ],
      "5m",
    );
    expect(out).toEqual([
      {
        time: "2026-06-16T13:35:00.000Z",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 0,
      },
    ]);
  });

  it("empty in, empty out", () => {
    expect(foldToGrid([], "5m")).toEqual([]);
  });
});

describe("barsCoverageEndSec", () => {
  it("is the newest 1-minute bar's start plus its own length", () => {
    expect(
      barsCoverageEndSec([bar("13:35:00", 1, 1, 1, 1), bar("13:36:00", 1, 1, 1, 1)]),
    ).toBe(utc("13:37:00"));
  });

  it("takes the MAXIMUM, not the last element — array position never grants authority", () => {
    expect(
      barsCoverageEndSec([bar("13:36:00", 1, 1, 1, 1), bar("13:35:00", 1, 1, 1, 1)]),
    ).toBe(utc("13:37:00"));
  });

  it("ignores unparseable timestamps", () => {
    expect(
      barsCoverageEndSec([
        bar("13:35:00", 1, 1, 1, 1),
        { time: "not-a-date", open: 1, high: 1, low: 1, close: 1, volume: 0 },
      ]),
    ).toBe(utc("13:36:00"));
  });

  it("an empty payload covers nothing, so the live overlay stands alone", () => {
    expect(barsCoverageEndSec([])).toBe(-Infinity);
    expect(
      barsCoverageEndSec([
        { time: "not-a-date", open: 1, high: 1, low: 1, close: 1, volume: 0 },
      ]),
    ).toBe(-Infinity);
  });
});

describe("mergeBoundaryBucket", () => {
  it("authoritative open wins, extremes widen, live close wins", () => {
    expect(
      mergeBoundaryBucket(
        { open: 100, high: 104, low: 98, close: 103 }, // fetched partial
        { open: 999, high: 106, low: 96, close: 105 }, // live bucket
      ),
    ).toEqual({ open: 100, high: 106, low: 96, close: 105 });
  });

  it("keeps the fetched extremes when the live bucket saw a narrower range", () => {
    expect(
      mergeBoundaryBucket(
        { open: 100, high: 110, low: 90, close: 103 },
        { open: 102, high: 104, low: 101, close: 102 },
      ),
    ).toEqual({ open: 100, high: 110, low: 90, close: 102 });
  });

  it("is idempotent — re-merging its own output changes nothing", () => {
    const fetched = { open: 100, high: 104, low: 98, close: 103 };
    const live = { open: 101, high: 106, low: 99, close: 105 };
    const once = mergeBoundaryBucket(fetched, live);
    expect(mergeBoundaryBucket(fetched, once)).toEqual(once);
  });
});

describe("liveBucketDraw", () => {
  /** A live spot bucket. `lastSec` defaults to one second before the bucket
   *  ends, i.e. a live window that has run right up to the bucket's edge. */
  const live = (o: Partial<LiveCandle> & { time: number }): LiveCandle => ({
    open: 100,
    high: 106,
    low: 96,
    close: 105,
    lastSec: o.time + 299,
    openTrusted: true,
    ...o,
  });

  /** The fetched tail: bucket start, its OHLC, and how far the 1-minute bars
   *  behind it reach. */
  const tail = (time: number, coverageEndSec: number): FetchedTail => ({
    time,
    ohlc: { open: 90, high: 104, low: 98, close: 103 },
    coverageEndSec,
  });

  const T = utc("14:35:00");

  it("no fetched bars at all: a trusted bucket stands alone", () => {
    expect(liveBucketDraw(live({ time: T }), null, undefined)).toEqual({
      open: 100,
      high: 106,
      low: 96,
      close: 105,
    });
  });

  it("BELOW the tail: an IBKR bar already covers it", () => {
    const lb = live({ time: T - 300, lastSec: T - 1 });
    expect(liveBucketDraw(lb, tail(T, T + 60), undefined)).toBeNull();
  });

  it("AT the tail, extending past the payload: merge — this is the dead 5m overlay", () => {
    // 5m, 200s into the bucket: IBKR's bars run through +180s, the spot window
    // covers the seconds since. Neither side alone is the bucket.
    const lb = live({ time: T, lastSec: T + 200 });
    expect(liveBucketDraw(lb, tail(T, T + 180), undefined)).toEqual({
      open: 90, // the fetched bar's — the bucket's real first print
      high: 106,
      low: 96,
      close: 105, // the live sample — the freshest observation
    });
  });

  it("AT the tail: a forming bucket's range never RETRACTS as the window slides", () => {
    // The 120s spot window slides, so an excursion it sampled earlier in a 300s
    // bucket is gone from the live candle by a later render. Without folding the
    // already-drawn bucket in, the drawn high visibly drops mid-formation.
    const drawn = { open: 90, high: 111, low: 88, close: 104 };
    const lb = live({ time: T, lastSec: T + 200, high: 106, low: 96, close: 105 });
    expect(liveBucketDraw(lb, tail(T, T + 180), drawn)).toEqual({
      open: 90, // still the fetched bar's real first print
      high: 111, // the earlier excursion survives the window sliding past it
      low: 88,
      close: 105, // the close still tracks the freshest sample
    });
  });

  it("AT the tail but adding nothing past the payload: the fetched bar is the bucket", () => {
    // The default 1m path: the tail bar is a COMPLETED minute, so the live copy
    // of that minute knows nothing IBKR does not and must not restate its close.
    const lb = live({ time: T, lastSec: T + 59 });
    expect(liveBucketDraw(lb, tail(T, T + 60), undefined)).toBeNull();
  });

  it("a wedged spot feed stops contributing instead of re-asserting a frozen close", () => {
    // The SPX subscription wedges 2 minutes into the bucket while `state` events
    // keep arriving; boundSpotWindow bounds against the newest SAMPLE, so the
    // frozen window keeps re-offering the bucket. Every 60s poll then advanced
    // the fetched close and the next state event snapped it back — the tail
    // candle flickering backwards once a minute.
    const frozen = live({ time: T, lastSec: T + 120 });
    expect(liveBucketDraw(frozen, tail(T, T + 60), undefined)).not.toBeNull();
    expect(liveBucketDraw(frozen, tail(T, T + 180), undefined)).toBeNull();
    expect(liveBucketDraw(frozen, tail(T, T + 240), undefined)).toBeNull();
  });

  it("ABOVE the tail with a trusted open: the live candle stands alone", () => {
    const lb = live({ time: T + 300, lastSec: T + 400 });
    expect(liveBucketDraw(lb, tail(T, T + 240), undefined)).toEqual({
      open: 100,
      high: 106,
      low: 96,
      close: 105,
    });
  });

  it("ABOVE the tail WITHOUT one and nothing drawn: no candle is the honest answer", () => {
    const lb = live({ time: T + 300, lastSec: T + 400, openTrusted: false });
    expect(liveBucketDraw(lb, tail(T, T + 240), undefined)).toBeNull();
  });

  it("ABOVE the tail WITHOUT one but already drawn: extend it, never freeze it", () => {
    // 5m under stale IBKR bars. The 120s spot window covers the bucket's start
    // for two minutes and then cannot; without this the candle would sit frozen
    // at those two minutes and read as a complete five-minute candle.
    const drawn = { open: 100, high: 101, low: 99, close: 100.5 };
    const lb = live({
      time: T + 300,
      lastSec: T + 580,
      openTrusted: false,
      open: 102,
      high: 108,
      low: 97,
      close: 107,
    });
    expect(liveBucketDraw(lb, tail(T, T + 240), drawn)).toEqual({
      open: 100, // the trusted open captured while the window still covered it
      high: 108,
      low: 97,
      close: 107,
    });
  });
});
