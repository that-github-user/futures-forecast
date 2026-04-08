/**
 * useTick — re-render this component every `intervalMs` milliseconds.
 *
 * Returns the current epoch ms, which the caller can use as a fresh `now`
 * for time-relative calculations like countdowns. Used by the DC Signals
 * tab to drive lifecycle countdown UI without polling the server.
 */

import { useEffect, useState } from "react";

export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
