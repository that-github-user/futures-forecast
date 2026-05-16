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
 *   - Cold-start (stale=true AND spot===null): yellow warming-up banner
 *     replacing the chart. Program flow still surfaces since it's
 *     computed independently of the snapshotter.
 *   - Demo mode: small "DEMO" watermark in the corner so the operator
 *     doesn't mistake synthetic data for live SPX positioning.
 */

import { useStraddleData } from "../../hooks/useStraddleData";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import { RouteNav } from "../nav/RouteNav";
import { PinCandidatesPanel } from "./PinCandidatesPanel";
import { ProgramFlowBanner } from "./ProgramFlowBanner";
import { RealizedImpliedHeader } from "./RealizedImpliedHeader";
import { StraddleMapChart } from "./StraddleMapChart";
import { UpcomingProgramFlow } from "./UpcomingProgramFlow";

export function StraddlePage() {
  const { data, loading, demoMode } = useStraddleData();

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
            <RealizedImpliedHeader data={data} />

            {data && data.program_flow.active_windowed.length > 0 && (
              <ProgramFlowBanner events={data.program_flow.active_windowed} />
            )}

            {isColdStart && <ColdStartBanner />}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 7fr) minmax(280px, 3fr)",
                gap: 12,
                alignItems: "start",
              }}
            >
              <div>
                {!isColdStart && <StraddleMapChart data={data} height={540} />}
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

function ColdStartBanner() {
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
      <span style={{ fontWeight: 700, marginRight: 8 }}>Data is warming up</span>
      <span style={{ color: colors.textSecondary }}>
        — straddle snapshotter has not yet completed a snapshot for today's
        session. Program-flow calendar is still available below.
      </span>
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
