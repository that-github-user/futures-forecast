/**
 * LiveCountdown — leaf that renders "1h 23m", "5m 12s", or "23s" against
 * a fixed HH:MM ET target, re-rendering itself every second.
 *
 * Why a separate leaf: StrategyMonitorCard is expensive to re-render
 * (9 internal sub-components, leg tables, sizing math). Before this,
 * passing the live `secondsUntilNext` down from the parent forced every
 * card to re-render at 1Hz just so three digits could tick. Now the
 * card is React.memo'd, the parent's 1s tick only triggers reconciling
 * these tiny leaves, and the rest of the card stays still.
 *
 * Target is given as HH:MM (ET). mode="until" renders `target - now`,
 * clamped to 0 when the target has passed; mode="since" renders
 * `now - target`, clamped to 0 while the target is still in the future.
 * Both use the same ET-seconds-of-day reference frame as the lifecycle
 * state machine (lib/dcLifecycle), so a card whose state flipped on the
 * parent's slow tick agrees with the leaf's instantaneous display.
 */

import { useTick } from "../../hooks/useTick";
import { etSecondsOfDay, formatCountdown, parseHHMMToSeconds } from "../../lib/dcLifecycle";

interface Props {
  targetHHMM: string | null;
  mode: "until" | "since";
  /** Optional tick rate override, primarily for tests. */
  intervalMs?: number;
}

export function LiveCountdown({ targetHHMM, mode, intervalMs = 1000 }: Props) {
  const nowMs = useTick(intervalMs);
  if (targetHHMM == null) return null;
  const now = new Date(nowMs);
  const targetSec = parseHHMMToSeconds(targetHHMM);
  const nowSec = etSecondsOfDay(now);
  const delta = mode === "until" ? targetSec - nowSec : nowSec - targetSec;
  return <>{formatCountdown(Math.max(0, delta))}</>;
}
