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
        background: "#0a0e17",
        fontFamily: "Inter, sans-serif",
        gap: 16,
      }}
    >
      <h2 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 18, margin: 0 }}>
        DC Trading Dashboard
      </h2>
      <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
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
            background: "#1e293b",
            border: error ? "1px solid #ef4444" : "1px solid #334155",
            borderRadius: 6,
            padding: "8px 14px",
            color: "#e2e8f0",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            outline: "none",
            width: 240,
          }}
        />
        <button
          type="submit"
          style={{
            background: "#3b82f6",
            border: "none",
            borderRadius: 6,
            padding: "8px 20px",
            color: "#fff",
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Unlock
        </button>
      </form>
      {error && (
        <span style={{ color: "#ef4444", fontSize: 12 }}>Incorrect password</span>
      )}
      <a
        href="#/"
        style={{ color: "#64748b", fontSize: 11, textDecoration: "none", marginTop: 8 }}
      >
        Back to ES Dashboard
      </a>
    </div>
  );
}
