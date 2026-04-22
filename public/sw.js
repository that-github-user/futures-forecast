// Minimal service worker.
//
// The ONLY thing this SW needs to do today is exist + register with a
// scope of "/" so Safari iOS treats the site as a PWA when the user
// taps "Add to Home Screen". Once installed, iOS unlocks the
// Notification API for foreground use within the standalone PWA —
// which is when the dashboard's existing `new Notification(...)`
// calls actually run (in-page state-change triggers).
//
// We don't serve cache-first or do any offline fanciness — the
// dashboard needs a live API connection to mean anything, so caching
// the shell without caching the data would render confusingly stale
// UIs. A future server-driven Web Push setup (pushManager.subscribe
// + VAPID + a daemon-side publisher) would add a 'push' event
// listener here.

self.addEventListener("install", (event) => {
  // Activate immediately on first install so the PWA install flow
  // doesn't block on the old SW draining (there is no old SW yet,
  // but this is the right habit for future updates).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any pages that were loaded before this SW was
  // registered — mostly relevant on first install within an
  // existing tab. Cheap; no client state to migrate.
  event.waitUntil(self.clients.claim());
});

// No fetch handler → the browser falls back to its default network
// behavior. Deliberately a pass-through PWA; see the header comment.
