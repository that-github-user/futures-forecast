/**
 * useCapitalSummary — one-shot fetch of the Capital Allocation research
 * payload from the DC API.
 *
 * The payload (policies + EV ranking + compounding curves) is static, so we
 * fetch once on mount. No polling — re-fetches only on page reload. Falls
 * through gracefully when the daemon is unreachable; callers should treat
 * `null` as "no policy config yet" and hide dependent UI.
 */

import { useEffect, useState } from "react";

import { dcApi } from "../api/dcClient";
import type { DCAllocationPolicy, DCCapitalSummary, PolicyKey } from "../api/dcTypes";

export function useCapitalSummary() {
  const [summary, setSummary] = useState<DCCapitalSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dcApi.capitalSummary().then((result) => {
      if (cancelled) return;
      setSummary(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const findPolicy = (key: PolicyKey): DCAllocationPolicy | null => {
    if (!summary) return null;
    return summary.policies.find((p) => p.key === key) ?? null;
  };

  return { summary, loading, findPolicy };
}
