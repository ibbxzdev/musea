"use client";

import * as React from "react";

/**
 * The value, but only once it has stopped changing for `delay` ms.
 *
 * Used for the search boxes. Passing every keystroke to `useQuery` would open and close a
 * Convex subscription per character — each one a full-text index read — for a result that
 * is thrown away before it paints.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
