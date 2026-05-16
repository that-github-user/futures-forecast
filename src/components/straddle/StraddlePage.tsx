/**
 * StraddlePage — 0DTE SPX strike-positioning page at `#/straddle`.
 *
 * Layout (per spec):
 *   - Top: RouteNav (cross-route)
 *   - Strip 1: RealizedImpliedHeader (headline metrics)
 *   - Strip 2: ProgramFlowBanner (only when active_windowed non-empty)
 *   - Body: 2-column grid
 *       Left (~70%): StraddleMapChart
 *       Right (~30%): PinCandidatesPanel + UpcomingProgramFlow stacked
 *
 * States:
 *   - Loading: centered "Loading…" placeholder for first render.
 *   - Cold-start (stale=true AND spot===null): amber "still loading"
 *     banner replacing the chart. Program flow still surfaces since
 *     it's computed independently of the snapshotter.
 *   - Demo mode: small "DEMO" watermark in the corner so the operator
 *     doesn't mistake synthetic data for live SPX positioning.
 */

import type { ProgramFlowEvent } from "../../api/terminalTypes";
import { useStraddleData } from "../../hooks/useStraddleData";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import { RouteNav } from "../nav/RouteNav";
import { PinCandidatesPanel } from "./PinCandidatesPanel";
import { ProgramFlowBanner } from "./ProgramFlowBanner";
import { RealizedImpliedHeader } from "./RealizedImpliedHeader";
import { StraddleMapChart } from "./StraddleMapChart";
import { StrikeVelocityTape } from "./StrikeVelocityTape";
import { UpcomingProgramFlow } from "./UpcomingProgramFlow";
import {
  formatNextSessionLabel,
  formatWindowTime,
  nextSessionDate,
} from "./programFlowFormatters";
import "./StraddlePage.css";

export function StraddlePage() {
  const { data, loading, demoMode, refetch, refreshing } = useStraddleData();

  // Cold-start: snapshotter hasn't yet written a row today. Headline
  // metric fields are null but `program_flow` is still populated, so
  // we surface that even with the warming-up banner in place.
  const isColdStart = !!data && data.stale && data.spot == null;

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textPrimary,
      }}
    >
      <RouteNav current="straddle" />

      <main
        style={{
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          position: "relative",
        }}
      >
        {loading && !data ? (
          <div
            style={{
              height: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.textMuted,
              fontSize: 13,
              letterSpacing: "0.04em",
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            <RealizedImpliedHeader
              data={data}
              onRefresh={refetch}
              refreshing={refreshing}
            />

            {data && data.program_flow.active_windowed.length > 0 && (
              <ProgramFlowBanner events={data.program_flow.active_windowed} />
            )}

            {isColdStart && (
              <ColdStartBanner
                upcoming={data?.program_flow.upcoming ?? []}
              />
            )}

            <div className="straddle-body-grid">
              <div className="straddle-chart-row">
                {!isColdStart && (
                  <div className="straddle-chart-cell">
                    <StraddleMapChart data={data} height={540} />
                  </div>
                )}
                {/* Strike Velocity Tape — frozen Friday-close trade-tick
                    replay. Renders independently of the live snapshot
                    so it surfaces even during cold-start when the
                    chart is hidden. The component renders its own
                    "(no replay available)" placeholder when the
                    backend hasn't run the replay script yet. */}
                {data?.velocity_tape !== undefined && (
                  <div className="straddle-velocity-cell">
                    <StrikeVelocityTape
                      tape={data?.velocity_tape ?? null}
                      strikeOrder={
                        data?.strikes
                          ? [...data.strikes]
                              .map((s) => s.strike)
                              .sort((a, b) => b - a)
                          : undefined
                      }
                      height={540}
                    />
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <PinCandidatesPanel
                  candidates={data?.pin_candidates ?? []}
                  spot={data?.spot ?? null}
                />
                <UpcomingProgramFlow
                  upcoming={data?.program_flow.upcoming ?? []}
                  coldStart={isColdStart}
                />
              </div>
            </div>
          </>
        )}

        {demoMode && <DemoWatermark />}
      </main>
    </div>
  );
}

function ColdStartBanner({ upcoming }: { upcoming: ProgramFlowEvent[] }) {
  // Cold-start covers three operationally distinct cases: weekend,
  // holiday, and pre-first-snapshot during a live session (rare). In
  // all three the snapshotter is producing no rows. Rather than the
  // generic "still loading" copy (misleading on a Saturday), pivot to
  // a next-session preview by reading the first entry off the sorted
  // upcoming list — that's the date the snapshotter will resume.
  const nextDate = nextSessionDate(upcoming);
  const sessionLabel = nextDate ? formatNextSessionLabel(nextDate) : null;
  const sessionOpen = upcoming.length > 0
    ? formatWindowTime(upcoming[0].window_start)
    : null;

  const message = sessionLabel && sessionOpen
    ? `Market closed. Showing next-session preview for ${sessionLabel}. Chain data populates at ${sessionOpen}.`
    : "Today's 0DTE chain snapshot is still loading. Program-flow calendar is available below.";

  return (
    <div
      style={{
        padding: "12px 14px",
        background: withAlphaByte(colors.accentAmber, 0x14),
        border: `1px solid ${withAlpha(colors.accentAmber, 0.4)}`,
        borderRadius: 6,
        color: colors.accentAmber,
        fontFamily: fonts.sans,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: colors.textSecondary }}>{message}</span>
    </div>
  );
}

function DemoWatermark() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 14,
        padding: "4px 10px",
        background: withAlphaByte(colors.accentAmber, 0x18),
        border: `1px solid ${withAlpha(colors.accentAmber, 0.4)}`,
        borderRadius: 4,
        color: colors.accentAmber,
        fontFamily: fonts.sans,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        pointerEvents: "none",
      }}
    >
      DEMO DATA
    </div>
  );
}
