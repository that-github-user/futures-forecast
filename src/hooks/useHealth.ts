/** Hook: poll server health every 15 seconds. */

import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { HealthResponse } from "../api/types";

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const h = await api.health();
        setHealth(h);
      } catch {
        setHealth(null);
      }
    };

    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, []);

  return health;
}
