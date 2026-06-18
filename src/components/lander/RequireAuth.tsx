/**
 * Wraps a gated route. While the session check is in flight, shows a
 * minimal loader (so we don't flash gated content or bounce a logged-in
 * operator to the lander). If the check resolves unauthenticated, sends
 * them back to `#/` (the lander). If authenticated — or no gate is
 * configured (dev/demo) — renders children unchanged.
 */

import { useEffect, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import { colors, fonts } from "../../styles/tokens";

interface Props {
  children: ReactNode;
}

export function RequireAuth({ children }: Props) {
  const { authed, checking, hasGate } = useAuth();

  useEffect(() => {
    if (hasGate && !checking && !authed) {
      window.location.hash = "#/";
    }
  }, [hasGate, checking, authed]);

  if (!hasGate) return <>{children}</>;
  if (checking) return <AuthLoader />;
  if (!authed) return null; // redirecting to the lander
  return <>{children}</>;
}

/** Centered loader matching the dashboard surface tones — mirrors the
 *  route-chunk fallback so verifying the session doesn't flash an
 *  unstyled gap before the gated content (or the lander) appears. */
function AuthLoader() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        fontSize: 13,
        letterSpacing: "0.02em",
      }}
    >
      Loading…
    </div>
  );
}
