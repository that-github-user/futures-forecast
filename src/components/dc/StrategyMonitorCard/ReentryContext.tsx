/**
 * ReentryContext — multi-entry-time annotation block.
 *
 * Renders only when the strategy has more than one discrete entry time
 * AND has at least one open position. The card's existing LegDetailBlock
 * already shows the *current* resolver output (per the SL worker, which
 * keeps resolving for multi-entry strategies even after the first slot
 * has filled). This block contextualizes that — it tells the trader:
 *
 *   1. "Your existing position is from {earlier slot}, paid {entry_debit};
 *      the legs you're looking at would be a re-entry at {next slot}."
 *   2. Live MTM on the open position — what the daemon would realize
 *      closing it at mid right now (current_net_value × 100 vs entry_debit
 *      × 100, scaled by quantity). Sourced from the broker_state sidecar's
 *      per-leg mid quotes; null when any leg's mid hasn't populated.
 *   3. Delta vs. the upcoming preview — if the live preview's net debit
 *      is materially better than what we paid earlier, the trader may
 *      want to consider closing the open position and letting the later
 *      slot fire (the daemon won't re-enter while a position is open —
 *      `blocked_duplicate`).
 */

import { colors, fonts } from "../../../styles/tokens";
import type { DCPosition } from "../../../api/dcTypes";
import { useTick } from "../../../hooks/useTick";
import { classifyReentry, formatTimeSince, pnlColor } from "./reentryHelpers";

/** Live "Xh Ym ago" leaf — re-renders itself every minute against an
 *  ISO entry timestamp. Same isolation pattern as <LiveCountdown>:
 *  ReentryContext is memo'd, but this leaf opts in to a 60s tick so
 *  the displayed age stays fresh without busting the parent's memo
 *  on every 1Hz parent-tick. */
function TimeSinceEntry({ iso }: { iso: string | null }) {
  const nowMs = useTick(60_000);
  if (!iso) return null;
  const entryMs = Date.parse(iso);
  if (Number.isNaN(entryMs)) return null;
  const deltaSec = Math.floor((nowMs - entryMs) / 1000);
  return <>{formatTimeSince(deltaSec)}</>;
}

interface Props {
  /** Open positions for THIS strategy only (caller filters by name). */
  positions: DCPosition[];
  /** Live preview net debit from the SL worker — what a re-entry costs now. */
  previewNetDebit: number | null;
  /** Strategy's entry direction — drives delta-coloring. */
  entryDirection: "debit" | "credit";
}

function formatEntryClock(isoEntryTime: string | null): string {
  if (!isoEntryTime) return "—";
  // entry_time is ISO ET; render HH:MM only.
  const t = isoEntryTime.includes("T") ? isoEntryTime.split("T")[1] : isoEntryTime;
  const hhmm = t.slice(0, 5);
  return hhmm || "—";
}

export function ReentryContext({ positions, previewNetDebit, entryDirection }: Props) {
  if (positions.length === 0) return null;

  // Pick the earliest still-open position as the anchor — the multi-entry
  // case is "you already entered at the first slot; here's what the next
  // slot looks like." Sorting by entry_time picks the first slot.
  const anchor = [...positions].sort((a, b) =>
    (a.entry_time ?? "").localeCompare(b.entry_time ?? "")
  )[0];

  const paidDebit = anchor.entry_debit;
  const previewAvailable = previewNetDebit != null && Number.isFinite(previewNetDebit);
  const delta = previewAvailable ? previewNetDebit - paidDebit : null;
  const deltaPct = previewAvailable && paidDebit > 0 ? (delta as number) / paidDebit : null;
  const classification = classifyReentry(paidDebit, previewNetDebit, entryDirection);
  const deltaColor =
    classification === "better"
      ? colors.accentGreen
      : classification === "worse"
        ? colors.accentRed
        : colors.textMuted;

  return (
    <div
      style={{
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        fontFamily: fonts.mono,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: colors.textSecondary,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontFamily: fonts.sans,
          }}
        >
          Open from {formatEntryClock(anchor.entry_time)} · Re-entry preview
        </span>
        <span style={{ color: colors.textMuted, fontSize: 10 }}>
          ×{anchor.quantity} · <TimeSinceEntry iso={anchor.entry_time} />
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: colors.textMuted }}>
          paid <span style={{ color: colors.textPrimary }}>${paidDebit.toFixed(2)}</span>
          {anchor.broker_entry_debit != null &&
            Math.abs(anchor.broker_entry_debit - paidDebit) >= 0.01 && (
              <span style={{ color: colors.textMuted, marginLeft: 6 }}>
                (broker ${anchor.broker_entry_debit.toFixed(2)})
              </span>
            )}
        </span>
        <span style={{ color: colors.textMuted }}>
          now{" "}
          <span style={{ color: previewAvailable ? colors.textPrimary : colors.textDim }}>
            {previewAvailable ? `$${(previewNetDebit as number).toFixed(2)}` : "—"}
          </span>
        </span>
      </div>

      {/* Live MTM row — only when the daemon's broker_state has populated
          mids for all 4 legs. Tracks the position the trader holds RIGHT
          NOW (not the upcoming-slot preview the row above shows). */}
      {anchor.current_net_value != null && anchor.unrealized_pnl != null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
            paddingTop: 2,
            borderTop: `1px dashed ${colors.borderDim}`,
          }}
        >
          <span style={{ color: colors.textMuted }}>
            MTM{" "}
            <span style={{ color: colors.textPrimary }}>
              ${anchor.current_net_value.toFixed(2)}
            </span>
          </span>
          <span style={{ color: pnlColor(anchor.unrealized_pnl), whiteSpace: "nowrap" }}>
            {anchor.unrealized_pnl >= 0 ? "+" : ""}
            {/* Pin to en-US so a viewer with a comma-decimal locale
                doesn't see "$1.234 unrealized" for $1234. */}
            ${Math.round(anchor.unrealized_pnl).toLocaleString("en-US")} unrealized
            {paidDebit > 0 && anchor.quantity > 0 && (
              /* Per-contract pct, NOT scaled by quantity — a 1-contract
                 −20% and a 5-contract −20% are the same trade thesis;
                 the dollar figure already conveys total exposure. */
              <span style={{ marginLeft: 4, color: pnlColor(anchor.unrealized_pnl) }}>
                ({(((anchor.current_net_value - paidDebit) / paidDebit) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
        </div>
      )}

      {delta != null && deltaPct != null && (
        <div style={{ display: "flex", justifyContent: "flex-end", color: deltaColor }}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(2)} ({(deltaPct * 100).toFixed(1)}%)
          {classification === "better" && (
            <span style={{ marginLeft: 6, fontSize: 10 }}>better re-entry</span>
          )}
          {classification === "worse" && (
            <span style={{ marginLeft: 6, fontSize: 10 }}>worse re-entry</span>
          )}
        </div>
      )}
    </div>
  );
}
