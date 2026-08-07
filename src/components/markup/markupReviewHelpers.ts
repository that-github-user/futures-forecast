/**
 * Pure helpers for the Markup Review pane — alert filtering, lightweight-charts
 * marker construction (clustered + MFE-encoded), the crosshair→alert index, and
 * the subset-stats rollup. No React / no chart lib state, so all unit-testable.
 */

import type { UTCTimestamp } from "lightweight-charts";
import type { MarkupReviewAlert } from "../../api/terminalTypes";
import { floorEpochSec, type Timeframe } from "../../lib/tfBuckets";

// ── ET session-date helpers ───────────────────────────────────────────

/** yyyymmdd for a Date in America/New_York (session_date is ET). */
export function etDateString(d: Date = new Date()): string {
  // en-CA → "YYYY-MM-DD"; strip the dashes.
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return s.replace(/-/g, "");
}

/** yyyymmdd ↔ the <input type="date"> value (YYYY-MM-DD). */
export const toInputDate = (yyyymmdd: string): string =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;
export const fromInputDate = (v: string): string => v.replace(/-/g, "");

/** Step a session date one weekday in `dir` (-1 prev, +1 next), skipping
 *  weekends (most empty days) and never going past `maxYmd` (today, ET) on
 *  a forward step. Holidays still land on an empty session — rare enough
 *  that the pane's "no data" state is fine. yyyymmdd in/out. */
export function shiftSessionDate(
  yyyymmdd: string,
  dir: -1 | 1,
  maxYmd: string = etDateString(),
): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6);
  const d = +yyyymmdd.slice(6, 8);
  let dt = new Date(Date.UTC(y, m - 1, d));
  do {
    dt = new Date(dt.getTime() + dir * 86_400_000);
  } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6); // skip Sun/Sat
  const out = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
  // Clamp forward steps to today (no future sessions).
  return dir === 1 && out > maxYmd ? yyyymmdd : out;
}

// ── filters ────────────────────────────────────────────────────────────

export interface AlertFilters {
  direction: "all" | "up" | "down";
  /** σ floor — hide alerts below this spread_z. */
  minZ: number;
  /** |dist_from_atm| ceiling (null = no limit) — e.g. "ATM-only" = 0/5. */
  maxDist: number | null;
  /** Include pending/lost (NULL-outcome) alerts. The pane honors this for the
   *  STATS rollup only; the causal chart always renders every fired strike
   *  (status is a post-fire field and must not scope the at-fire arrows). */
  includePending: boolean;
}

export const DEFAULT_FILTERS: AlertFilters = {
  direction: "all",
  minZ: 0,
  maxDist: null,
  includePending: false,
};

export function passesFilters(a: MarkupReviewAlert, f: AlertFilters): boolean {
  if (f.direction !== "all" && a.direction !== f.direction) return false;
  if (a.spread_z != null && a.spread_z < f.minZ) return false;
  if (
    f.maxDist != null &&
    a.dist_from_atm != null &&
    Math.abs(a.dist_from_atm) > f.maxDist
  )
    return false;
  if (!f.includePending && a.status !== "finalized") return false;
  return true;
}

export const filterAlerts = (
  alerts: MarkupReviewAlert[],
  f: AlertFilters,
): MarkupReviewAlert[] => alerts.filter((a) => passesFilters(a, f));

// ── markers ──────────────────────────────────────────────────────────

// Arrows are styled by the at-fire CONVICTION of the setup — NOT by how the move
// turned out. Conviction is a causal score (ladder breadth + ask magnitude +
// time-of-day) from features known the instant the signal fires; outcome columns
// (mfe/mae/es_*) never touch the styling. Spec + provenance: quotemark
// docs/signal_arrow_styling.md (17-session re-validation 2026-07-10, §8 — constants
// move only under the §8 change rule). Channels are kept separate so a strong short
// can't look like a weak long: SHAPE = direction, COLOR = conviction tier, SIZE =
// ask magnitude, ×N badge = cluster breadth, OPACITY = muted dead-bucket flag.

/** ISO (UTC-Z) → lightweight-charts UTCTimestamp (epoch seconds). */
export const isoToUtc = (iso: string): UTCTimestamp =>
  Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;

/** Minutes since the 09:30 ET open for an ISO instant (DST-correct via Intl). */
export function minSinceOpenET(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm - (9 * 60 + 30);
}

export type Tier = "strong" | "moderate" | "weak" | "caution";

/** Ladder breadth — the strongest, monotonic factor (per-event PF 1.55/1.46/2.45). */
export function breadthScore(clusterSize: number): number {
  if (clusterSize >= 4) return 1.0;
  if (clusterSize >= 2) return 0.3;
  return 0.0;
}

/** RAW max ask-jump — coarse "is it a real markup" floor only. The 8-session
 *  2.2–3.0 sweet spot did not replicate out-of-sample (§8: irreproducible under
 *  any tested variable/grain — provenance void); <1.8 is the worst post-fit
 *  bucket (PF 0.64/0.67 under both exit conventions). */
export function askScore(maxAskJump: number): number {
  return maxAskJump >= 1.8 ? 0.3 : 0.0;
}

export type SessionBucket =
  | "preOpen"
  | "open"
  | "morning"
  | "midday"
  | "afternoon"
  | "powerCurb";

/** RTH session phase from minutes since the 09:30 ET open. Bucket edges live
 *  here only, so todScore and isMuted can never disagree on a fire's bucket. */
export function sessionBucket(minSinceOpen: number): SessionBucket {
  if (minSinceOpen < 0) return "preOpen"; // RTH-gated feed; defensive
  if (minSinceOpen < 30) return "open";
  if (minSinceOpen < 120) return "morning";
  if (minSinceOpen < 240) return "midday";
  if (minSinceOpen < 360) return "afternoon";
  return "powerCurb";
}

/** Time-of-day score by session phase (re-validated 2026-07-10, §8: open held in
 *  every era; midday dead in every era; afternoon +0.5 → 0.0 — collapsed post-fit,
 *  exit conventions disagree on sign so neutral only; power+curb 0.0 → -0.5 —
 *  PF 0.45 over 50 post-fit events, both exit conventions agree). */
const TOD_SCORES: Record<SessionBucket, number> = {
  preOpen: 0.0,
  open: 1.0,
  morning: 0.0,
  midday: -0.5,
  afternoon: 0.0,
  powerCurb: -0.5,
};

export const todScore = (minSinceOpen: number): number =>
  TOD_SCORES[sessionBucket(minSinceOpen)];

/** Muted buckets — midday and power+curb (curb added 2026-07-10, §8): dead zones
 *  whose arrows are visually de-emphasized and can never read STRONG. (With align
 *  dropped the STRONG block is currently unreachable — muted-bucket max score is
 *  0.8 — kept for spec parity.) */
const MUTED_BUCKETS: ReadonlySet<SessionBucket> = new Set(["midday", "powerCurb"]);

export const isMuted = (minSinceOpen: number): boolean =>
  MUTED_BUCKETS.has(sessionBucket(minSinceOpen));

export interface ConvictionInput {
  clusterSize: number;
  maxAskJump: number;
  minSinceOpen: number;
  /** the cluster fired ATM-only (every strike dist==0, no wings). */
  atmOnly: boolean;
}

export interface Conviction {
  score: number;
  tier: Tier;
  /** Dead-bucket fire (midday, power+curb) — render de-emphasized (§4). */
  muted: boolean;
}

/** Causal conviction from at-fire features. The doc's optional align_score (prior
 *  /ES trend) is omitted — the review feed carries no pre-fire ES context — so
 *  score ∈ [-0.5, 2.3] and STRONG (≥2.0) is effectively open-window-with-breadth
 *  only (matches the data: post-fit STRONG events are rare but positive). */
export function conviction(i: ConvictionInput): Conviction {
  const score =
    breadthScore(i.clusterSize) +
    askScore(i.maxAskJump) +
    todScore(i.minSinceOpen);
  // Trap overrides → force CAUTION regardless of the sum.
  const trap =
    (i.clusterSize === 1 && i.maxAskJump >= 3.0) || // lone big-ask spike (PF ~0.9)
    i.atmOnly; // ATM-only duds
  const muted = isMuted(i.minSinceOpen);
  let tier: Tier;
  if (trap) tier = "caution";
  else if (score >= 2.0 && !muted) tier = "strong";
  else if (score >= 1.0) tier = "moderate";
  else tier = "weak";
  return { score, tier, muted };
}

/** Arrow size from RAW ask magnitude (monotonic — "longer = bigger markup"). */
export function askSize(maxAskJump: number): number {
  if (maxAskJump >= 3.0) return 4;
  if (maxAskJump >= 2.2) return 3;
  if (maxAskJump >= 1.8) return 2;
  return 1;
}

/** Tier → color, per direction. Brightness (conviction) is a separate channel from
 *  direction (shape). CAUTION is a neutral-grey filled circle (lightweight-charts
 *  circles are solid, not hollow) — so a lone big-ask spike or ATM-only dud never
 *  looks hot. */
export const CONVICTION_COLORS: Record<"up" | "down", Record<Tier, string>> = {
  up: { strong: "#3fb950", moderate: "#2f8f43", weak: "#2b6b3f", caution: "#6e7681" },
  down: { strong: "#f85149", moderate: "#c2403a", weak: "#7d342f", caution: "#6e7681" },
};

/** ~55% alpha suffix for muted-bucket arrows. lightweight-charts markers have no
 *  dash style, so the spec's dashed-vs-solid muted channel (§4) is encoded as
 *  opacity instead. CAUTION keeps its solid grey — the trap style stays distinct. */
export const MUTED_ALPHA = "8c";

export const markerColor = (c: Conviction, up: boolean): string => {
  const base = CONVICTION_COLORS[up ? "up" : "down"][c.tier];
  return c.muted && c.tier !== "caution" ? `${base}${MUTED_ALPHA}` : base;
};

export interface ReviewMarker {
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  size: number;
  text: string;
}

// GROUPING IS NOT PLACEMENT. The spec defines an event as a ONE-MINUTE
// same-direction cluster and every PF number backing the constants above was fit
// at that grain, so the grain must not follow the display timeframe: scoring on a
// 5-minute grouping merges up to five events into one, inflates the breadth badge
// on 39% of alerts, changes the displayed tier on 19% of them, and — the reason
// this is a safety property and not a cosmetic one — dissolves the lone-spike
// trap, which re-validation puts as the worst-performing bucket measured. Every
// transition it produces FLATTERS. So alerts are clustered on the 1-minute floor
// of `alert_ts` (tf-invariant, second-resolution, carried on every alert) and the
// resulting marker is merely DRAWN on the display grid.
//
// The server's `bar_time` is deliberately not used as the grouping key: it is
// pre-floored to the requested `tf`, which is exactly the coupling this splits.

/** Epoch seconds of an alert's true fire instant. NaN when `alert_ts` won't
 *  parse — every consumer below DROPS those rather than keying on the NaN.
 *  Grouping now depends on this parse where the pane once only formatted it for
 *  a tooltip line, so the blast radius of a malformed instant grew from one row
 *  to every marker on the chart: a NaN key collapses every such alert into ONE
 *  event whose count becomes its `cluster_size`, feeding a fabricated breadth
 *  into the conviction score and the lone-spike trap test, and placing a marker
 *  at an unplottable time. */
const alertSec = (a: MarkupReviewAlert): number =>
  Math.floor(Date.parse(a.alert_ts) / 1000);

/** The spec's EVENT key — `alert_ts` floored to the minute (epoch seconds). */
export const alertEventSec = (a: MarkupReviewAlert): number =>
  floorEpochSec(alertSec(a), "1m");

/** One same-direction, same-minute event: the spec's unit of conviction. */
export interface AlertCluster {
  /** `alert_ts` floored to the minute (epoch seconds). */
  eventSec: number;
  direction: "up" | "down";
  /** The spec's `cluster_size` / ladder-breadth channel. */
  clusterSize: number;
  maxAskJump: number;
  conviction: Conviction;
}

/** Split alerts into the spec's 1-minute same-direction events, ascending by
 *  event minute then direction (a total order — every consumer that renders more
 *  than one cluster needs a stable one).
 *
 *  Breadth is the count of the passed-in cluster; the pane feeds the
 *  status-inclusive set so a pending/lost strike still counts toward the at-fire
 *  ladder (explicit σ/dist view filters still scope what's shown).
 *
 *  Time-of-day is read off `alert_ts` rather than the event key: flooring to a
 *  minute cannot change an ET hour:minute, so the two are the same bucket, and
 *  reading the raw instant keeps one fewer derived value in the scoring path. */
export function clusterAlerts(alerts: MarkupReviewAlert[]): AlertCluster[] {
  const groups = new Map<string, MarkupReviewAlert[]>();
  for (const a of alerts) {
    if (!Number.isFinite(alertSec(a))) continue;
    const key = `${alertEventSec(a)}|${a.direction}`;
    const arr = groups.get(key);
    if (arr) arr.push(a);
    else groups.set(key, [a]);
  }
  const out: AlertCluster[] = [];
  for (const group of groups.values()) {
    const clusterSize = group.length;
    const maxAskJump = group.reduce((m, g) => Math.max(m, g.ask_jump ?? 0), 0);
    out.push({
      eventSec: alertEventSec(group[0]),
      direction: group[0].direction,
      clusterSize,
      maxAskJump,
      conviction: conviction({
        clusterSize,
        maxAskJump,
        minSinceOpen: minSinceOpenET(group[0].alert_ts),
        atmOnly: group.every((g) => g.dist_from_atm === 0),
      }),
    });
  }
  return out.sort(
    (a, b) =>
      a.eventSec - b.eventSec || a.direction.localeCompare(b.direction),
  );
}

/** Which of two events sharing one display bar and one direction keeps the
 *  marker. A 5-minute bar can carry five, and lightweight-charts draws one glyph
 *  per (time, position) legibly — so one wins outright rather than being summed:
 *  `×N` IS the spec's cluster_size channel, and a sum would be a different
 *  quantity wearing the same encoding, re-introducing the inflated breadth this
 *  file's grouping split exists to prevent.
 *
 *  CAUTION outranks everything. It is a trap override, not a low score — the
 *  whole hazard of a coarser display grid is that it only ever FLATTERS, so the
 *  one marker that survives collision must be the warning if there is one.
 *  Below that: higher conviction score, then breadth, then ask magnitude, then
 *  the earliest event. That last key makes the comparison TOTAL — two events on
 *  one display bar in one direction have distinct minutes by construction — so
 *  the winner is pinned even when every scored channel ties, which is common:
 *  two breadth-2 events in one 5-minute bucket agree on all three. (Independence
 *  from input order comes from clusterAlerts' sort, not from here.) */
function outranks(a: AlertCluster, b: AlertCluster): boolean {
  const aTrap = a.conviction.tier === "caution";
  const bTrap = b.conviction.tier === "caution";
  if (aTrap !== bTrap) return aTrap;
  if (a.conviction.score !== b.conviction.score)
    return a.conviction.score > b.conviction.score;
  if (a.clusterSize !== b.clusterSize) return a.clusterSize > b.clusterSize;
  if (a.maxAskJump !== b.maxAskJump) return a.maxAskJump > b.maxAskJump;
  return a.eventSec < b.eventSec;
}

/** One marker per (display bar, direction), styled by the CAUSAL conviction of
 *  the 1-minute event it represents (never by outcome). */
export function buildMarkers(
  alerts: MarkupReviewAlert[],
  tf: Timeframe = "1m",
): ReviewMarker[] {
  const winners = new Map<string, AlertCluster>();
  for (const c of clusterAlerts(alerts)) {
    const key = `${floorEpochSec(c.eventSec, tf)}|${c.direction}`;
    const held = winners.get(key);
    if (!held || outranks(c, held)) winners.set(key, c);
  }

  const out: ReviewMarker[] = [];
  for (const c of winners.values()) {
    const up = c.direction === "up";
    out.push({
      time: floorEpochSec(c.eventSec, tf) as UTCTimestamp,
      position: up ? "belowBar" : "aboveBar",
      color: markerColor(c.conviction, up),
      shape:
        c.conviction.tier === "caution" ? "circle" : up ? "arrowUp" : "arrowDown",
      size: askSize(c.maxAskJump),
      text: c.clusterSize > 1 ? `×${c.clusterSize}` : "",
    });
  }
  // lightweight-charts requires markers ascending (and effectively unique) by time.
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Index alerts by the DISPLAY bar they are drawn inside, so a crosshair returns
 *  every alert under the hovered candle — at 5m that is up to five minutes'
 *  worth, and the tooltip prints each one's true `alert_ts` second, which is the
 *  only place the sub-bar timing survives.
 *
 *  Keyed off `alert_ts`, not the server's `bar_time`: a live alert is floored
 *  client-side to the minute while a fetched one carries the server's `tf`
 *  flooring, so the same event arriving down both paths would otherwise index
 *  under two different keys and split its own cluster. */
export function indexByBarTime(
  alerts: MarkupReviewAlert[],
  tf: Timeframe = "1m",
): Map<number, MarkupReviewAlert[]> {
  const m = new Map<number, MarkupReviewAlert[]>();
  for (const a of alerts) {
    const sec = alertSec(a);
    if (!Number.isFinite(sec)) continue;
    const t = floorEpochSec(sec, tf);
    const arr = m.get(t);
    if (arr) arr.push(a);
    else m.set(t, [a]);
  }
  return m;
}

// ── subset stats ───────────────────────────────────────────────────────

export interface SubsetStats {
  n: number;
  finalized: number;
  mfeGe5: number | null;
  mfeGe10: number | null;
  medianMfe: number | null;
  medianMae: number | null;
  medianTMfe: number | null;
  dirHit: number | null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const nums = (xs: (number | null)[]): number[] =>
  xs.filter((x): x is number => x != null);

/** Rollup over the (already-filtered) alerts. Outcome rates are over FINALIZED
 *  alerts (mfe present); dirHit is over any alert with a realized move. */
export function subsetStats(alerts: MarkupReviewAlert[]): SubsetStats {
  const fin = alerts.filter((a) => a.mfe != null);
  const mfes = fin.map((a) => a.mfe as number);
  const n = fin.length;
  const real = nums(alerts.map((a) => a.realized_move));
  return {
    n: alerts.length,
    finalized: n,
    mfeGe5: n ? mfes.filter((m) => m >= 5).length / n : null,
    mfeGe10: n ? mfes.filter((m) => m >= 10).length / n : null,
    medianMfe: median(mfes),
    medianMae: median(nums(fin.map((a) => a.mae))),
    medianTMfe: median(nums(fin.map((a) => a.t_mfe_s))),
    dirHit: real.length ? real.filter((x) => x > 0).length / real.length : null,
  };
}
