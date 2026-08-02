/**
 * Event class — the "should we be in this position right now?" axis for the
 * DC signal_events audit log.
 *
 * The Events tab carries two orthogonal axes and this module owns one of
 * them end to end. `outcomeColor`/`labelFor` in DCEventsTab.tsx answer
 * "what happened mechanically" — a severity ramp from green fill through
 * amber soft-block to red hard failure. This module answers the only
 * question the operator actually asks: did the system call this play, or
 * did it decline it?
 *
 * THE BOUNDARY, and why it is these two outcomes and no others.
 * `engine/entry.py::attempt_entry` is a gate ladder. Every `EntryBlocked`
 * it raises names the gate that stopped it, and the gates run in a fixed
 * order — prechecks (direction, risk, duplicate, signal), connect, strike
 * resolve, deconflict, leg qualify, S/L ratio, VIX, entry debit, sizing,
 * margin — and only THEN `_persist_and_submit`. Exactly two outcomes are
 * raised BELOW that line:
 *
 *   blocked_entries_disabled — the `dc_entry.enabled` master switch
 *     (entry.py:984). It sits above the first state mutation and below
 *     every evaluation gate, so reaching it means the daemon WOULD have
 *     entered. The comment at entry.py:950 says exactly that.
 *   blocked_order — the reprice ladder ran and the market never crossed
 *     (entry.py:1082). The daemon committed, went to market, got zero
 *     fills.
 *
 * That predicate is NOT our invention — it is the daemon's own gate
 * ORDERING. Both raises sit inside `_persist_and_submit`, below every gate
 * that could still have said no on the merits; every other outcome names a
 * gate that did say no.
 *
 * It is deliberately NOT the daemon's phantom-write predicate, which is
 * strictly narrower. `entry.py:1258` reads `if blocked.outcome ==
 * 'blocked_order':` — a string equality, not a membership test — so a
 * `blocked_entries_disabled` play gets a `signal_events` row and NOTHING
 * else. Following the phantom writer instead would file the entire
 * post-retirement record under `no_trade`, which is the exact error this
 * module exists to undo. The asymmetry is a daemon-side gap, not a
 * classification signal: from 2026-08-01 the decision is preserved and the
 * through-expiry P&L is not, so the Tent tab's "Missed Entries" panel stops
 * accruing while this tab keeps counting. Any copy that sends the operator
 * across to that panel MUST name which outcome carries a phantom — see
 * `eventClassTooltip`.
 *
 * The two are also mutually exclusive by config: with the master switch
 * off (2026-08-01 onward) `blocked_order` is unreachable, because its emit
 * site is below the switch. `blocked_entries_disabled` is its structural
 * successor, which is why the class must be their UNION — together they
 * are the complete "the daemon decided to trade" history across the
 * retirement boundary.
 *
 * WHY THIS SUPERSEDES `isTradeWorthyEvent`. That predicate put
 * `blocked_order` on the NO side, reasoning "we do not hold the position".
 * True — and irrelevant to the question the headline tile asks. On the
 * 2026-04-20..2026-07-31 record that reading rendered "14 should be in"
 * while the Tent tab, in the same product, rendered 82 phantoms as "Missed
 * Entries": two answers to one question. "Do we hold it" is the `in`
 * class. "Should we be in it" is `in` ∪ `should_be_in`.
 *
 * UNKNOWN OUTCOMES FALL TO `no_trade`, deliberately. The conservative
 * direction is to UNDER-claim — an unrecognised string must never inflate
 * the should-be-in headline, because that headline is the number the
 * operator reconciles against real fills. `eventOutcomeClass.test.ts` pins
 * every outcome string `engine/entry.py` can emit, so a new daemon outcome
 * breaks that test and forces a conscious classification rather than
 * sliding into the safe bucket forever.
 */

import { colors } from "../../styles/tokens";

export type EventClass = "in" | "should_be_in" | "no_trade";

/** Display order, and the exhaustive set of classes. */
export const EVENT_CLASS_ORDER: EventClass[] = ["in", "should_be_in", "no_trade"];

/**
 * The two outcomes raised after every evaluation gate cleared. Kept as a
 * list rather than an `||` chain so the test can iterate it and so adding
 * a third (a future "submitted, awaiting fill" state, say) is a one-line
 * change in one place.
 */
const SHOULD_BE_IN_OUTCOMES: readonly string[] = [
  "blocked_order",
  "blocked_entries_disabled",
];

export function classifyOutcome(outcome: string): EventClass {
  if (outcome === "entered") return "in";
  if (SHOULD_BE_IN_OUTCOMES.includes(outcome)) return "should_be_in";
  return "no_trade";
}

export function eventClassLabel(c: EventClass): "IN" | "SHOULD BE IN" | "NO TRADE" {
  switch (c) {
    case "in": return "IN";
    case "should_be_in": return "SHOULD BE IN";
    case "no_trade": return "NO TRADE";
  }
}

/**
 * Class colours are deliberately OFF the per-outcome severity ramp.
 *
 * `outcomeColor` owns accentGreen → accentAmber → accentRedLight →
 * accentRed as a "how badly did the mechanics fail" gradient, and
 * accentBlue is spoken for by the active-chip border. Reusing any of those
 * here would make the class row read as more of the same ramp instead of
 * as a second, independent axis. accentIndigo (`tokens.ts:45`) had zero
 * consumers under `components/dc/` and is the only free accent that still
 * reads as "informational, not a failure tier" — which is the whole point:
 * a should-be-in row is not an error, it is a play the system called.
 */
export function eventClassColor(c: EventClass): string {
  switch (c) {
    case "in": return colors.accentGreen;
    case "should_be_in": return colors.accentIndigo;
    case "no_trade": return colors.textMuted;
  }
}

/**
 * Trader-facing, and honest about the two parts that sting: `should_be_in`
 * plays are ones we are NOT in, and `in` is a count of fills, not of open
 * risk. Live counts are never baked into this copy — the chips derive them
 * from the visible data, so the prose can't drift away from the numbers
 * next to it. The one hard number below is the two 2026-04-20 ghost fills,
 * and that set is closed: `entered` is unreachable with the master switch
 * off, so no row can join it.
 *
 * Every cross-tab pointer here is scoped by OUTCOME, never by date. The
 * daemon's phantom writer is a string equality on `blocked_order`
 * (`entry.py:1258`), so "everything since 2026-05-15 has a phantom" — the
 * wording this copy used to carry — is false for every row logged from the
 * 2026-08-01 retirement onward, which is the only kind of row it will get
 * from here on.
 */
export function eventClassTooltip(c: EventClass): string {
  switch (c) {
    case "in":
      return "Filled — the broker reported a cross and the daemon wrote a row in the "
        + "positions table. This counts fills over the selected range; it is NOT live "
        + "inventory. Those positions go on to close, and the Positions tab shows only "
        + "what is still open — usually nothing. Two 2026-04-20 rows were later "
        + "cancelled as pre-fix ghost fills, so read this as \"the daemon recorded a "
        + "fill\", not \"money is at risk right now\".";
    case "should_be_in":
      return "Every evaluation gate cleared, so the daemon decided to trade. Two endings "
        + "land here. The entry reprice ladder exhausted with zero fills — it went to "
        + "market and the market never crossed. Or the dc_entry.enabled master switch "
        + "was off, so no order was ever sent. Either way the system called the play "
        + "and we are NOT in it. Only the ladder rows carry a phantom position, shown "
        + "on the Tent tab as \"Missed Entries\" (phantom capture shipped 2026-05-15); "
        + "entries-off rows have no phantom and no through-expiry P&L, so this tab is "
        + "their whole record.";
    case "no_trade":
      return "The system declined before ever sending an order — signal skip, S/L gate, "
        + "duplicate position, risk limit, or a data/connection failure. Nothing "
        + "reached the market.";
  }
}

// ── Outcome display order ────────────────────────────────────────

/**
 * Canonical ORDER for the per-outcome chips — not a whitelist.
 *
 * It used to be a whitelist (`SUMMARY_OUTCOMES`), and a chip only rendered
 * when its outcome appeared in it. That silently hid `blocked_entries_disabled`
 * and `blocked_direction` from the summary while their rows sat in the
 * table below — the same defect twice. Chips are now DERIVED from the
 * outcomes actually present in the data and merely SORTED by this list, so
 * a new daemon outcome can be mis-ordered but can never vanish.
 *
 * Order groups by class first (entered, then the two should-be-in
 * outcomes) so the chip row reads as a refinement of the class row above
 * it, then walks the no-trade gates roughly in the order the daemon hits
 * them. It is colocated with the class map on purpose: a new outcome needs
 * an entry in BOTH, and one file makes that impossible to half-do.
 *
 * Typed `readonly string[]` rather than `as const` so `.includes(someString)`
 * type-checks — this list is compared against arbitrary backend strings.
 */
export const OUTCOME_DISPLAY_ORDER: readonly string[] = [
  "entered",
  "blocked_order",
  "blocked_entries_disabled",
  "skipped_signal",
  "blocked_sl",
  "blocked_vix",
  "blocked_margin",
  "blocked_size",
  "blocked_risk",
  "blocked_duplicate",
  "blocked_strike",
  "blocked_deconflict",
  "blocked_legs",
  "blocked_conn",
  "blocked_data",
  "blocked_direction",
];

/**
 * De-duplicate, then sort by OUTCOME_DISPLAY_ORDER with anything unknown
 * appended alphabetically at the end. Unknown outcomes are kept, NOT
 * dropped — that is the entire reason this function exists rather than
 * `ORDER.filter(o => counts[o])`.
 */
export function orderOutcomesForDisplay(present: readonly string[]): string[] {
  const seen = Array.from(new Set(present));
  const known = seen
    .filter((o) => OUTCOME_DISPLAY_ORDER.includes(o))
    .sort((a, b) => OUTCOME_DISPLAY_ORDER.indexOf(a) - OUTCOME_DISPLAY_ORDER.indexOf(b));
  const unknown = seen
    .filter((o) => !OUTCOME_DISPLAY_ORDER.includes(o))
    .sort();
  return [...known, ...unknown];
}
