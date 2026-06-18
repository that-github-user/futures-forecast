/**
 * LumenLander — public auth gate at #/.
 *
 * The lander IS the auth surface (no separate sign-in step). On
 * unlock, redirects the operator to the gated default route. Direct
 * access to gated routes without unlock falls back here.
 *
 * Locked design: ~/.claude/plans/main-page-redesign-design-spec.md §3.
 * Visual reference: /tmp/lumen-proof/lander.html.
 */

import { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import "./LumenLander.css";

/** Resolved at module load — operator's reduced-motion preference. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface Props {
  /** Hash route to navigate to on successful unlock. Default `#/app`
   *  (the terminal — current load-bearing surface; Forecast and DC
   *  are reachable via cross-route nav from there). */
  redirectTo?: string;
}

export function LumenLander({ redirectTo = "#/app" }: Props) {
  const { login, authed, hasGate } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(prefersReducedMotion);

  // Track changes to the OS-level reduced-motion preference live.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // A returning operator whose session cookie is still valid shouldn't be
  // re-prompted — once the session check resolves authed, go straight in.
  useEffect(() => {
    if (hasGate && authed) {
      window.location.hash = redirectTo;
    }
  }, [hasGate, authed, redirectTo]);

  // The lander IS the auth surface. Submit verifies the password
  // SERVER-SIDE (sets the HttpOnly session cookie on success). In
  // dev/demo (no gate) login() resolves ok immediately, so an empty
  // submit still "opens the door".
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const res = await login(value);
    setSubmitting(false);
    if (res.ok) {
      window.location.hash = redirectTo;
    } else {
      setError(true);
      setRateLimited(res.rateLimited ?? false);
      setValue("");
    }
  };

  return (
    <div className="lumen-root">
      <NoiseGradient />

      <div className="lumen-page">
        <header className="lumen-topbar">
          <div className="lumen-brand">
            <span className="alpha">α</span>denoisedalpha
          </div>
          <div className="lumen-edition">
            <span className="seal">№ 01 · MMXXVI</span>
          </div>
        </header>

        <section className="lumen-hero">
          <div className="lumen-heroline">
            <Ornament reducedMotion={reducedMotion} />
            <span className="l1">Denoised</span>
            <span className="l2">Alpha.</span>
          </div>

          <div className="lumen-whisper">A private terminal.</div>

          <form
            className={`lumen-auth${error ? " error" : ""}`}
            onSubmit={onSubmit}
            autoComplete="off"
          >
            <input
              type="password"
              placeholder="Passphrase."
              aria-label="Passphrase"
              autoComplete="off"
              autoFocus
              value={value}
              disabled={submitting}
              onChange={(e) => {
                setValue(e.target.value);
                setError(false);
                setRateLimited(false);
              }}
            />
            <button type="submit" className="enter" disabled={submitting}>
              {submitting ? "…" : "Enter."}
            </button>
          </form>
          {rateLimited && (
            <p className="lumen-auth-msg" role="alert">
              Too many attempts. Wait a moment, then try again.
            </p>
          )}
        </section>

        <footer className="lumen-foot">
          <span className="em">Sub rosa.</span>
          <span className="em">By invitation.</span>
        </footer>
      </div>
    </div>
  );
}

/**
 * Page-wide diagonal noise gradient (TL noisy → BR clean).
 * Spec §3.3 — brand thesis as permanent atmospheric condition.
 */
function NoiseGradient() {
  return (
    <div className="lumen-bg-noise" aria-hidden="true">
      <svg preserveAspectRatio="none" viewBox="0 0 1920 1080">
        <defs>
          <filter id="lumen-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.2"
              numOctaves={2}
              seed={13}
              stitchTiles="stitch"
            />
            <feColorMatrix
              values="0 0 0 0 0.96
                      0 0 0 0 0.94
                      0 0 0 0 0.88
                      0 0 0 0.55 0"
            />
          </filter>
          <linearGradient id="lumen-fade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="0.25" stopColor="#ffffff" stopOpacity="0.65" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="0.75" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <mask id="lumen-fade-mask">
            <rect width="1920" height="1080" fill="url(#lumen-fade)" />
          </mask>
        </defs>
        <rect
          width="1920"
          height="1080"
          filter="url(#lumen-grain)"
          mask="url(#lumen-fade-mask)"
        />
      </svg>
    </div>
  );
}

/**
 * Atmospheric α — denoises into character on load, freezes.
 * Right-edge aligned to end of "Denoised" via title-anchored absolute
 * positioning (see CSS). Spec §3.4.
 *
 * When the operator prefers reduced motion, we skip the SMIL <animate>
 * child entirely. feDisplacementMap defaults `scale=0`, so the α
 * renders directly in its resolved (clean) form on first paint.
 */
function Ornament({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="ornament" aria-hidden="true">
      <svg viewBox="0 0 480 480" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="lumen-denoise" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves={3}
              seed={7}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              xChannelSelector="R"
              yChannelSelector="G"
            >
              {!reducedMotion && (
                <animate
                  attributeName="scale"
                  values="220;180;120;60;25;8;0"
                  keyTimes="0;0.18;0.36;0.54;0.72;0.88;1"
                  dur="3.6s"
                  fill="freeze"
                  calcMode="spline"
                  keySplines="0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1"
                />
              )}
            </feDisplacementMap>
          </filter>
        </defs>
        <text
          x="475"
          y="350"
          fontFamily="EB Garamond, Georgia, serif"
          fontStyle="italic"
          fontWeight="400"
          fontSize="440"
          fill="#5a564f"
          textAnchor="end"
          filter="url(#lumen-denoise)"
        >
          α
        </text>
      </svg>
    </div>
  );
}
