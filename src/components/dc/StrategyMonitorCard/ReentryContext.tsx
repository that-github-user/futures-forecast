/**
 * ReentryContext — multi-entry-time annotation block.
 *
 * Renders only when the strategy has more than one discrete entry time
 * AND has at least one open position. The card's existing LegDetailBlock
 * already shows the *current* resolver output (per the SL worker, which
 * keeps resolving for multi-entry strategies even after the first slot
 * has filled). This block contextualizes that — it tells the trader
 * "your existing position is from {earlier slot}, paid {entry_debit};
 * the legs you're looking at would be a re-entry at {next slot}."
 *
 * Plus a delta vs. the upcoming preview: if the live preview's net
 * debit is materially better than what we paid earlier, the trader
 * may want to consider closing the open position and letting the
 * later slot fire (the daemon won't re-enter while a position is
 * open — `blocked_duplicate`).
 *
 * Frontend-only feature: all data is already on the wire. No
 * backend changes needed.
 */

import { colors, fonts } from "../../../styles/tokens";
import type { DCPosition } from "../../../api/dcTypes";
import { classifyReentry } from "./reentryHelpers";

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
          ×{anchor.quantity}
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
