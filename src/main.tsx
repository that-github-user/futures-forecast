import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import App from "./App.tsx";

// Register the service worker so the site qualifies as a PWA and can
// be installed to iOS home screens — which is the only way Safari
// iOS exposes the Notification API to the dashboard. Registration is
// a no-op on browsers that already have Notification support in a
// plain tab (Chrome desktop/Android, Firefox, etc.) and degrades
// silently on older browsers that don't support serviceWorker.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Don't block app startup on registration failure; log and
      // continue. The dashboard still works, just no PWA install
      // on iOS (which matches pre-change behavior).
      // eslint-disable-next-line no-console
      console.warn("Service worker registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
