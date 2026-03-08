/** Hook: SSE subscription with polling fallback + auto demo mode. */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribePredictions } from "../api/client";
import { generateMockPrediction } from "../api/mock";
import type { PredictionResponse } from "../api/types";

const POLL_INTERVAL = 30_000;
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export function usePrediction() {
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(IS_DEMO);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);

  const fetchLatest = useCallback(async () => {
    try {
      const pred = await api.latestPrediction();
      setPrediction(pred);
      setError(null);
      setConnected(true);
      failCountRef.current = 0;
    } catch (err) {
      failCountRef.current++;
      // After 3 consecutive failures, switch to demo mode
      if (failCountRef.current >= 3 && !demoMode) {
        setDemoMode(true);
        setPrediction(generateMockPrediction());
        setError("API unreachable — showing demo data");
        setConnected(false);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      }
    }
  }, [demoMode]);

  useEffect(() => {
    if (demoMode) {
      setPrediction(generateMockPrediction());
      setConnected(false);
      // Refresh mock data every 5 minutes
      const id = setInterval(() => {
        setPrediction(generateMockPrediction());
      }, 300_000);
      return () => clearInterval(id);
    }

    // Try SSE first
    const cleanup = subscribePredictions(
      (pred) => {
        setPrediction(pred);
        setConnected(true);
        setError(null);
        failCountRef.current = 0;
      },
      () => {
        setConnected(false);
        // Start polling as fallback
        if (!pollRef.current) {
          pollRef.current = setInterval(fetchLatest, POLL_INTERVAL);
        }
      },
    );

    // Initial fetch
    fetchLatest();

    return () => {
      cleanup();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchLatest, demoMode]);

  return { prediction, connected, demoMode, error, refetch: fetchLatest };
}
