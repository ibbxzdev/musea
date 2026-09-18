"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { formatXlm } from "@musea/shared/amounts";
import { type TipErrorCode, userMessageFor } from "@musea/shared/errors";
import { contractUrl, txUrl } from "@musea/shared/stellar-links";
import { useAction, useQuery } from "convex/react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, HandCoins } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatRelativeDate } from "@/lib/musea/format";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";
import type { Tip } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

/**
 * Activity — every tip sent and received (Story 3.4, SOW Deliverable 3).
 *
 * This is the screen that makes a tip checkable after the fact. Until it existed the only
 * receipt was a toast that expired in ten seconds, which meant a curator who was not
 * looking at their phone when a tip landed had no way to see it at all — and SOW §6.1 asks
 * for Activity screenshots with working receipt links as Deliverable 3's evidence.
 *
 * **Two differently-sourced numbers share this page, on purpose.** The card at the top is
 * the curator's lifetime total read from TipJar contract state; the list underneath is our
 * own `tips` table. They are never summed from each other, so if they ever disagree the
 * disagreement is visible rather than papered over — which is the only honest way to show
 * a database record next to a chain record. Per docs/architecture.md, the chain is the authority.
 *
 * Every settled row links to its transaction on Stellar Expert. That link is the whole
 * point of the page: a reviewer with no technical setup can tap it and confirm the amount,
 * sender and recipient against the live ledger.
 */
export function ActivityView() {
  const tips = useQuery(api.tips.listMyTips, {});

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="sr-only">Activity</h1>

      <CuratorTotalCard tips={tips} />

      {tips === undefined ? (
        <ActivitySkeleton />
      ) : tips.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-2xl border">
          {tips.map((tip) => (
            <TipRow key={tip._id} tip={tip} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={HandCoins}
          title="No tips yet"
          description="Tips you send and receive show up here, each with a receipt you can check on Stellar."
        />
      )}
    </div>
  );
}

/**
 * Lifetime received, from `curator_total` in contract state.
 *
 * TipJar has exposed this view function since Deliverable 1 and nothing read it until now.
 * It is an `action` rather than a query — reading it means simulating a contract call, so
 * there is no subscription to hang off — which is why it re-reads when the reactive list
 * below reports a new settled tip rather than updating on its own.
 *
 * Hidden entirely for a curator with no deployed wallet. There is no address for the
 * contract to have credited, so there is no on-chain figure to show and nothing to link
 * to; a zero with a dead link would imply we had checked something we had not.
 */
function CuratorTotalCard({ tips }: { tips: Tip[] | undefined }) {
  const getMyCuratorTotal = useAction(api.stellar.tips.getMyCuratorTotal);
  const [total, setTotal] = React.useState<{ stroops: string; contractId: string | null } | null>(
    null,
  );

  // Re-read when the number of confirmed incoming tips changes. Keyed on the count rather
  // than on the array so an unrelated re-render — or a *sent* tip settling — does not cost
  // a contract simulation.
  const settledReceived =
    tips?.filter((tip) => tip.direction === "received" && tip.status === "success").length ?? 0;

  React.useEffect(() => {
    let cancelled = false;

    getMyCuratorTotal({})
      .then((result) => {
        if (!cancelled) setTotal(result);
      })
      .catch(() => {
        // An RPC hiccup must not render as "you have received nothing". Showing nothing is
        // honest; showing a wrong zero next to a list of real tips is not.
        if (!cancelled) setTotal(null);
      });

    return () => {
      cancelled = true;
    };
  }, [getMyCuratorTotal, settledReceived]);

  if (!total?.contractId) return null;

  return (
    <div className="mb-5 rounded-2xl border p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Received, all time
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {formatXlm(BigInt(total.stroops))} XLM
      </p>
      <a
        href={contractUrl(total.contractId, STELLAR_NETWORK)}
        target="_blank"
        rel="noreferrer noopener"
        className="tap-target -ml-1 inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Read from the TipJar contract, not from this list
        <ExternalLink aria-hidden className="size-3" />
      </a>
    </div>
  );
}

function TipRow({ tip }: { tip: Tip }) {
  const received = tip.direction === "received";
  const settled = tip.status === "success";
  // Only a *failed* amount is struck through. A pending one is in flight, not cancelled —
  // striking it through for the ~5 seconds before confirmation is precisely the "reads as
  // failed" mistake Story 3.4 warns about, and it would happen on camera every time.
  const failed = tip.status === "failed";
  const Icon = received ? ArrowDownLeft : ArrowUpRight;

  const counterparty = tip.counterparty?.handle
    ? `@${tip.counterparty.handle}`
    : (tip.counterparty?.name ?? "someone");

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          settled && received ? "bg-stellar/10 text-stellar" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium">
            {received ? "Received from" : "Sent to"} {counterparty}
          </p>
          <p
            className={cn(
              "shrink-0 text-sm font-semibold tabular-nums",
              failed && "text-muted-foreground line-through",
              !settled && !failed && "text-muted-foreground",
              settled && received && "text-stellar",
            )}
          >
            {received ? "+" : "−"}
            {formatXlm(BigInt(tip.amountStroops))} XLM
          </p>
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {/* The gallery is what the tip was *for*, so it stays reachable from the receipt.
              Community rather than /app/galleries: a received tip points at your own
              gallery, but a sent one points at someone else's, and only Community renders
              a gallery you do not own. */}
          <Link
            href={`/app/community/${tip.galleryId}`}
            className="underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {tip.galleryTitle}
          </Link>
          {" · "}
          {formatRelativeDate(tip.confirmedAt ?? tip.createdAt)}
        </p>

        <TipStatus tip={tip} />
      </div>
    </li>
  );
}

/**
 * The bottom line of a row: the receipt link, or why there isn't one.
 *
 * Pending reads as pending and never as failure — confirmation takes about five seconds,
 * and a row that looks broken for those five seconds is the single most misleading thing
 * this page could do during a demo (Story 3.4).
 */
function TipStatus({ tip }: { tip: Tip }) {
  if (tip.status === "success" && tip.txHash) {
    return (
      <a
        href={txUrl(tip.txHash, STELLAR_NETWORK)}
        target="_blank"
        rel="noreferrer noopener"
        className="tap-target -ml-1 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        View on Stellar Expert
        <ExternalLink aria-hidden className="size-3" />
      </a>
    );
  }

  if (tip.status === "pending") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        Waiting for confirmation…
      </p>
    );
  }

  return <p className="mt-1 text-xs text-destructive">{failureMessage(tip.errorCode)}</p>;
}

/**
 * `userMessageFor` is a plain lookup over a closed set, and `errorCode` arrives as an
 * optional string from the database — a row written by an older build, or by a code path
 * added since, would otherwise render as literal "undefined" on the page.
 */
function failureMessage(code: string | undefined): string {
  return userMessageFor((code ?? "UNKNOWN") as TipErrorCode) ?? userMessageFor("UNKNOWN");
}

function ActivitySkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
        <li key={index} className="flex items-start gap-3 px-4 py-3">
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
