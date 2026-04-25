/**
 * Wraps a gated route. If the operator hasn't unlocked the session,
 * sends them back to `#/` (the lander). If unlocked or no gate is
 * configured, renders children unchanged.
 */

import { useEffect, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";

interface Props {
  children: ReactNode;
}

export function RequireAuth({ children }: Props) {
  const { unlocked, hasGate } = useAuth();

  useEffect(() => {
    if (hasGate && !unlocked) {
      window.location.hash = "#/";
    }
  }, [hasGate, unlocked]);

  if (hasGate && !unlocked) return null;
  return <>{children}</>;
}
