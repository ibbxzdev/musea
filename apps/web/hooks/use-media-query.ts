"use client";

import * as React from "react";

/**
 * Subscribes to a CSS media query.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState` because the server has no
 * matchMedia: the server snapshot is always `false`, so the first client render matches
 * the HTML exactly and React swaps in the real value in the same commit. The
 * `useEffect` version renders the desktop layout for one frame on a phone.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `lg` breakpoint — where the tab rail has room to go vertical. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
