/**
 * Countdown to next 5-minute prediction update.
 * Shows overdue state when past expected time, STALE when very overdue.
 */

import { useEffect, useState } from "react";

interface Props {
  lastPredictionTime: string | null;
  intervalSeconds?: number;
}

export function CountdownTimer({ lastPredictionTime, intervalSeconds = 300 }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      if (!lastPredictionTime) {
        setRemaining(null);
        return;
      }

      const lastTime = new Date(lastPredictionTime).getTime();
      const nextTime = lastTime + intervalSeconds * 1000;
      const now = Date.now();
      const diff = Math.floor((nextTime - now) / 1000);
      setRemaining(diff);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastPredictionTime, intervalSeconds]);

  // Waiting state — no prediction received yet
  if (remaining === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 12,
          color: "#64748b",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#334155",
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
    textColor = "#ef4444";
    dotColor = "#ef4444";
    dotAnimation = "pulse 1s infinite";
  } else if (overdue) {
    const oSec = overdueSeconds % 60;
    display = `overdue ${overdueMinutes}m ${oSec.toString().padStart(2, "0")}s`;
    textColor = "#f59e0b";
    dotColor = "#f59e0b";
    dotAnimation = "pulse 1s infinite";
  } else {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    display = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    textColor = remaining < 30 ? "#f59e0b" : "#64748b";
    dotColor = remaining < 30 ? "#f59e0b" : "#334155";
    dotAnimation = remaining < 30 ? "pulse 1s infinite" : undefined;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "JetBrains Mono, monospace",
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
