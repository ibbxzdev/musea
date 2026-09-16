"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { formatXlm } from "@musea/shared/amounts";
import { contractUrl } from "@musea/shared/stellar-links";
import { useAction } from "convex/react";
import { ExternalLink } from "lucide-react";
import * as React from "react";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";

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
 * **And the badge links to the contract it was read from**, which is what turns "we say
 * so" into "go and check" — SOW §5.1 Week 3 asks for exactly that, and a number a reviewer
 * cannot click is a number they have to take on trust. The contract id travels back with
 * the total rather than being read from a second place, so the page can never link to a
 * different contract than the one that served the figure.
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
  const [contractId, setContractId] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    getGalleryTotal({ galleryId })
      .then(({ stroops, contractId: id }) => {
        if (cancelled) return;
        setTotal(BigInt(stroops));
        setContractId(id);
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

  const label = `◎ ${formatXlm(total)} XLM tipped`;

  // No contract id means the read came back without one — nothing to point at, so show the
  // number plainly rather than a link that goes nowhere.
  if (!contractId) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <a
      href={contractUrl(contractId, STELLAR_NETWORK)}
      target="_blank"
      rel="noreferrer noopener"
      // The badge sits inline next to a gallery title, so it cannot be 44px tall without
      // pushing the heading around. `py-2.5` gets the row to 36px and the hit area is
      // extended by the surrounding line box; the Activity page carries the full-size
      // targets for the same destinations.
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      title="See this total in TipJar contract state on Stellar Expert"
    >
      {label}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">— verify on Stellar Expert</span>
    </a>
  );
}
