/** Typed API client + SSE wrapper for the prediction backend.
 *
 * Falls back to mock data when VITE_DEMO_MODE=true or API unreachable.
 */

import type {
  HealthResponse,
  HistoryResponse,
  PredictionResponse,
  SignalResponse,
} from "./types";
import { generateMockHistory, generateMockPrediction } from "./mock";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
// In dev with vite proxy, use relative paths; in prod, use the full API URL
const API_BASE = import.meta.env.VITE_API_URL || "";
const API_KEY = import.meta.env.VITE_API_KEY || "";

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: (): Promise<HealthResponse> => {
    if (IS_DEMO) {
      return Promise.resolve({
        status: "demo",
        uptime_seconds: 0,
        last_prediction_time: new Date().toISOString(),
        last_bar_time: new Date().toISOString(),
        data_feed_status: "demo",
        model_loaded: true,
        gpu_available: false,
      });
    }
    return get<HealthResponse>("/api/v1/health");
  },

  latestPrediction: (): Promise<PredictionResponse> => {
    if (IS_DEMO) return Promise.resolve(generateMockPrediction());
    return get<PredictionResponse>("/api/v1/prediction/latest");
  },

  history: (n = 50): Promise<HistoryResponse> => {
    if (IS_DEMO) return Promise.resolve(generateMockHistory());
    return get<HistoryResponse>(`/api/v1/prediction/history?n=${n}`);
  },

  currentSignal: (): Promise<SignalResponse> => {
    if (IS_DEMO) return Promise.resolve(generateMockPrediction().signal);
    return get<SignalResponse>("/api/v1/signal/current");
  },
};

/** Subscribe to SSE prediction stream. Returns a cleanup function. */
export function subscribePredictions(
  onPrediction: (pred: PredictionResponse) => void,
  onError?: (err: Event) => void,
): () => void {
  if (IS_DEMO) {
    // In demo mode, push mock updates every 5 minutes
    const id = setInterval(() => {
      onPrediction(generateMockPrediction());
    }, 300_000);
    // Push initial immediately
    setTimeout(() => onPrediction(generateMockPrediction()), 100);
    return () => clearInterval(id);
  }

  const url = `${API_BASE}/api/v1/prediction/stream`;

  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as PredictionResponse;
      onPrediction(data);
    } catch {
      console.error("Failed to parse SSE data:", event.data);
    }
  };

  source.onerror = (err) => {
    console.error("SSE error:", err);
    onError?.(err);
  };

  return () => source.close();
}
