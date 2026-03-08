/**
 * Countdown to next 5-minute prediction update.
 */

import { useEffect, useState } from "react";

interface Props {
  lastPredictionTime: string | null;
  intervalSeconds?: number;
}

export function CountdownTimer({ lastPredictionTime, intervalSeconds = 300 }: Props) {
  const [remaining, setRemaining] = useState(intervalSeconds);

  useEffect(() => {
    const tick = () => {
      if (!lastPredictionTime) {
        setRemaining(intervalSeconds);
        return;
      }

      const lastTime = new Date(lastPredictionTime).getTime();
      const nextTime = lastTime + intervalSeconds * 1000;
      const now = Date.now();
      const diff = Math.max(0, Math.floor((nextTime - now) / 1000));
      setRemaining(diff);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastPredictionTime, intervalSeconds]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 12,
        color: remaining < 30 ? "#f59e0b" : "#64748b",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: remaining < 30 ? "#f59e0b" : "#334155",
          animation: remaining < 30 ? "pulse 1s infinite" : undefined,
        }}
      />
      Next: {display}
    </div>
  );
}
