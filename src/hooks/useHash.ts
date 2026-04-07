import { useCallback, useEffect, useState } from "react";

/** Lightweight hash-based routing hook. No React Router needed. */
export function useHash(): [string, (hash: string) => void] {
  const [hash, setHashState] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHashState(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setHash = useCallback((h: string) => {
    window.location.hash = h;
  }, []);

  return [hash, setHash];
}
