/**
 * Pure helpers for the Markup Review pane — alert filtering, lightweight-charts
 * marker construction (clustered + MFE-encoded), the crosshair→alert index, and
 * the subset-stats rollup. No React / no chart lib state, so all unit-testable.
 */

import type { UTCTimestamp } from "lightweight-charts";
import type { MarkupReviewAlert } from "../../api/terminalTypes";

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
// ask magnitude, ×N badge = cluster breadth.

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

/** Time-of-day score by RTH session phase (re-validated 2026-07-10, §8: open held
 *  in every era; midday dead in every era). */
export function todScore(minSinceOpen: number): number {
  if (minSinceOpen < 0) return 0; // pre-open (RTH-gated feed; defensive)
  if (minSinceOpen < 30) return 1.0; // open [0,30)
  if (minSinceOpen < 120) return 0.0; // morning [30,120)
  if (minSinceOpen < 240) return -0.5; // midday [120,240) — dead zone
  // afternoon [240,360): +0.5 → 0.0 (2026-07-10) — collapsed post-fit under the
  // fit convention; exit conventions disagree on sign, so neutral only.
  if (minSinceOpen < 360) return 0.0;
  // power+curb [360,…): 0.0 → -0.5 (2026-07-10) — PF 0.45 over 50 post-fit
  // events, both exit conventions agree.
  return -0.5;
}

/** Muted buckets — midday [120,240) and power+curb [360,…) (curb added
 *  2026-07-10, §8): can never read STRONG. With align dropped the block is
 *  currently unreachable (muted-bucket max score is 0.8) — kept for spec parity. */
export const isMuted = (minSinceOpen: number): boolean =>
  (minSinceOpen >= 120 && minSinceOpen < 240) || minSinceOpen >= 360;

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
  let tier: Tier;
  if (trap) tier = "caution";
  else if (score >= 2.0 && !isMuted(i.minSinceOpen)) tier = "strong";
  else if (score >= 1.0) tier = "moderate";
  else tier = "weak";
  return { score, tier };
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

export interface ReviewMarker {
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  size: number;
  text: string;
}

function pushGroup(
  m: Map<string, MarkupReviewAlert[]>,
  key: string,
  a: MarkupReviewAlert,
): void {
  const arr = m.get(key);
  if (arr) arr.push(a);
  else m.set(key, [a]);
}

/** One marker per (bar, direction) cluster, styled by CAUSAL conviction (never by
 *  outcome). Breadth is the count of the passed-in cluster; the pane feeds the
 *  status-inclusive set so a pending/lost strike still counts toward the at-fire
 *  ladder (explicit σ/dist view filters still scope what's shown). */
export function buildMarkers(alerts: MarkupReviewAlert[]): ReviewMarker[] {
  const groups = new Map<string, MarkupReviewAlert[]>();
  for (const a of alerts) pushGroup(groups, `${a.bar_time}|${a.direction}`, a);

  const out: ReviewMarker[] = [];
  for (const group of groups.values()) {
    const up = group[0].direction === "up";
    const clusterSize = group.length;
    const maxAskJump = group.reduce((m, g) => Math.max(m, g.ask_jump ?? 0), 0);
    const atmOnly = group.every((g) => g.dist_from_atm === 0);
    const c = conviction({
      clusterSize,
      maxAskJump,
      minSinceOpen: minSinceOpenET(group[0].bar_time),
      atmOnly,
    });
    out.push({
      time: isoToUtc(group[0].bar_time),
      position: up ? "belowBar" : "aboveBar",
      color: CONVICTION_COLORS[up ? "up" : "down"][c.tier],
      shape: c.tier === "caution" ? "circle" : up ? "arrowUp" : "arrowDown",
      size: askSize(maxAskJump),
      text: clusterSize > 1 ? `×${clusterSize}` : "",
    });
  }
  // lightweight-charts requires markers ascending (and effectively unique) by time.
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Index alerts by floored bar-time epoch (seconds) so a crosshair at a bar
 *  returns the whole cluster for the tooltip. */
export function indexByBarTime(
  alerts: MarkupReviewAlert[],
): Map<number, MarkupReviewAlert[]> {
  const m = new Map<number, MarkupReviewAlert[]>();
  for (const a of alerts) {
    const t = isoToUtc(a.bar_time) as number;
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
