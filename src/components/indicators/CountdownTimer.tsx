/**
 * Countdown to next 5-minute prediction update.
 *
 * Anchored to the last bar's timestamp (the actual market data time),
 * not the prediction generation time. The next update is expected ~one
 * bar interval after the last bar, plus typical yfinance delay (~15-20s
 * for server fetch + generation). We use wall-clock 5-minute boundaries
 * relative to the last bar as the anchor.
 *
 * Shows overdue state when past expected time, STALE when very overdue.
 */

import { useEffect, useState } from "react";
import { colors, fonts } from "../../styles/tokens";

interface Props {
  lastPredictionTime: string | null;
  /** Unix timestamp (seconds) of the last context candle — the true data anchor. */
  lastBarTime?: number | null;
  intervalSeconds?: number;
}

export function CountdownTimer({ lastPredictionTime, lastBarTime, intervalSeconds = 300 }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      if (!lastPredictionTime && !lastBarTime) {
        setRemaining(null);
        return;
      }

      const now = Date.now();

      if (lastBarTime) {
        // Anchor to the bar schedule: next bar arrives at lastBarTime + interval,
        // then add ~20s for server fetch + generation time
        const serverDelay = 20_000; // typical fetch + generation overhead
        const nextBarMs = (lastBarTime + intervalSeconds) * 1000 + serverDelay;
        // If we've already passed that, compute the next one after now
        if (nextBarMs < now) {
          // How many intervals have we missed?
          const elapsed = now - lastBarTime * 1000;
          const intervalsElapsed = Math.floor(elapsed / (intervalSeconds * 1000));
          const nextAfterNow = (lastBarTime + (intervalsElapsed + 1) * intervalSeconds) * 1000 + serverDelay;
          setRemaining(Math.floor((nextAfterNow - now) / 1000));
        } else {
          setRemaining(Math.floor((nextBarMs - now) / 1000));
        }
      } else {
        // Fallback: use prediction generation time
        const lastTime = new Date(lastPredictionTime!).getTime();
        const nextTime = lastTime + intervalSeconds * 1000;
        setRemaining(Math.floor((nextTime - now) / 1000));
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastPredictionTime, lastBarTime, intervalSeconds]);

  // Waiting state — no prediction received yet
  if (remaining === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: fonts.mono,
          fontSize: 12,
          color: colors.textMuted,
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colors.borderMid,
          }}
        />
        Waiting...
      </div>
    );
  }

  const overdue = remaining < 0;
  const overdueSeconds = overdue ? Math.abs(remaining) : 0;
  const overdueMinutes = Math.floor(overdueSeconds / 60);
  const isStale = overdueSeconds > 600; // > 10 minutes

  let display: string;
  let textColor: string;
  let dotColor: string;
  let dotAnimation: string | undefined;

  if (isStale) {
    display = "STALE";
    textColor = colors.accentRed;
    dotColor = colors.accentRed;
    dotAnimation = "pulse 1s infinite";
  } else if (overdue) {
    const oSec = overdueSeconds % 60;
    display = `overdue ${overdueMinutes}m ${oSec.toString().padStart(2, "0")}s`;
    textColor = colors.accentAmber;
    dotColor = colors.accentAmber;
    dotAnimation = "pulse 1s infinite";
  } else {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    display = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    textColor = remaining < 30 ? colors.accentAmber : colors.textMuted;
    dotColor = remaining < 30 ? colors.accentAmber : colors.borderMid;
    dotAnimation = remaining < 30 ? "pulse 1s infinite" : undefined;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.mono,
        fontSize: 12,
        color: textColor,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          animation: dotAnimation,
        }}
      />
      {overdue ? display : `Next: ${display}`}
    </div>
  );
}
