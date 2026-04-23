/**
 * Password gate for the DC Trading Dashboard.
 *
 * SECURITY NOTE: This is UX obfuscation, NOT a real security boundary.
 * - The bcrypt hash and any API key are baked into the JS bundle (visible
 *   to anyone who views source).
 * - sessionStorage state can be set manually via devtools to bypass.
 * - The REAL security boundary is the DC API server's X-DC-Key header
 *   validation. Ensure DC_API_KEYS is set in production (server-side).
 * - The gate prevents casual visitors from seeing the dashboard, nothing more.
 *
 * Compares user input against a bcrypt hash via VITE_DC_PASSWORD_HASH.
 * Stores unlock state in sessionStorage so refreshing doesn't re-prompt.
 */

import { useState, type ReactNode } from "react";
import bcrypt from "bcryptjs";
import { colors, fonts } from "../../styles/tokens";

const PASSWORD_HASH = import.meta.env.VITE_DC_PASSWORD_HASH || "";

interface Props {
  children: ReactNode;
}

export function DCAuthGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem("dc-unlocked") === "true"
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  // No hash configured — allow access (dev mode)
  if (!PASSWORD_HASH) return <>{children}</>;
  if (unlocked) return <>{children}</>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bcrypt.compareSync(input, PASSWORD_HASH)) {
      sessionStorage.setItem("dc-unlocked", "true");
      setUnlocked(true);
    } else {
      setError(true);
      setInput("");
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        gap: 16,
      }}
    >
      <h2 style={{ color: colors.textPrimary, fontWeight: 600, fontSize: 18, margin: 0 }}>
        DC Trading Dashboard
      </h2>
      <p style={{ color: colors.textMuted, fontSize: 13, margin: 0 }}>
        Enter password to access
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          placeholder="Password"
          autoFocus
          style={{
            background: colors.borderDim,
            border: `1px solid ${error ? colors.accentRed : colors.borderMid}`,
            borderRadius: 6,
            padding: "8px 14px",
            color: colors.textPrimary,
            fontFamily: fonts.mono,
            fontSize: 14,
            outline: "none",
            width: 240,
          }}
        />
        <button
          type="submit"
          style={{
            background: colors.accentBlue,
            border: "none",
            borderRadius: 6,
            padding: "8px 20px",
            // Button text stays pure white against the blue — not part
            // of the muted-text palette. Kept inline.
            color: "#fff",
            fontFamily: fonts.sans,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Unlock
        </button>
      </form>
      {error && (
        <span style={{ color: colors.accentRed, fontSize: 12 }}>Incorrect password</span>
      )}
      <a
        href="#/"
        style={{ color: colors.textMuted, fontSize: 11, textDecoration: "none", marginTop: 8 }}
      >
        Back to ES Dashboard
      </a>
    </div>
  );
}
