"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { formatXlm } from "@musea/shared/amounts";
import { useAction } from "convex/react";
import * as React from "react";

/**
 * A gallery's lifetime tips, read from TipJar contract state.
 *
 * **This number comes off the chain, never out of the `tips` table.** That is the whole
 * claim of Deliverable 1: the totals are public, independently verifiable contract state,
 * and anyone can check this badge against Stellar Expert. Summing our own database would
 * render an identical-looking number that proves nothing, and the demo would be asserting
 * something it has not shown. Keep the two separately sourced so a divergence is visible
 * rather than hidden.
 *
 * It is an `action` rather than a query because reading it means simulating a contract
 * call, so there is no subscription to hang off — hence `version`, which the tip flow
 * bumps to ask for a re-read once a tip has settled.
 */
export function GalleryTotalBadge({
  galleryId,
  version = 0,
}: {
  galleryId: Id<"galleries">;
  version?: number;
}) {
  const getGalleryTotal = useAction(api.stellar.tips.getGalleryTotal);
  const [total, setTotal] = React.useState<bigint | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    getGalleryTotal({ galleryId })
      .then((stroops) => {
        if (cancelled) return;
        setTotal(BigInt(stroops));
        setFailed(false);
      })
      .catch(() => {
        // An RPC hiccup must not turn into a wrong number. Showing nothing is honest;
        // showing "0 XLM tipped" for a gallery that has been tipped is not.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [galleryId, version, getGalleryTotal]);

  if (failed) return null;

  if (total === null) {
    return (
      <span
        className="inline-block h-6 w-28 animate-pulse rounded-full bg-muted align-middle"
        aria-busy="true"
        aria-label="Reading the on-chain total"
      />
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
      ◎ {formatXlm(total)} XLM tipped
    </span>
  );
}
