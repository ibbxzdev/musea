"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { toStroops } from "@musea/shared/amounts";
import { type TipErrorCode, userMessageFor } from "@musea/shared/errors";
import { shorten, txUrl } from "@musea/shared/stellar-links";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { HandCoins } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  EXPECTED_NETWORK,
  FreighterError,
  signWithFreighter,
  useFreighter,
} from "@/lib/musea/freighter";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "./responsive-modal";

/**
 * The one-tap tip flow — the user-facing half of Deliverable 2.
 *
 * Tips are signed by the user's own wallet (Freighter) and land in the **gallery creator's**
 * own wallet. There is no app-managed wallet on either side any more: Musea holds no keys,
 * so it can neither spend for the tipper nor receive on the creator's behalf.
 *
 * **No Stellar code here.** This component knows a gallery id and an amount string. The
 * server builds and simulates the transaction, the extension signs an opaque XDR string,
 * and the server submits it. That is CLAUDE.md rule 1, and the lint rule is its backstop.
 *
 * Note what is *not* sent: no user id, no public key, no "from" and no "to". Both ends are
 * derived server-side — the tipper from `ctx.auth`, the recipient from `gallery.ownerId`.
 */

/**
 * Hoisted so the stroop conversion runs once at module load rather than on every render,
 * and so a malformed preset fails at import time instead of inside a tap handler. Custom
 * amounts are deliberately out of scope for this deliverable.
 */
const PRESETS = ["1", "5", "10"].map((amount) => ({ amount, stroops: toStroops(amount) }));

const DEFAULT_AMOUNT = "5";

type TipButtonProps = {
  galleryId: Id<"galleries">;
  curatorName: string | null;
  curatorHandle: string | null;
  /** Whether the signed-in user owns this gallery. */
  isOwn: boolean;
  /** Fired once a tip has settled, so the caller can re-read the on-chain total. */
  onTipped?: () => void;
};

/** Why tipping cannot proceed right now, or null when it can. */
// `href` is a literal rather than `string` because Next typed routes reject an unchecked
// path, and the only destination here is the profile.
type Blocker = { reason: string; action?: { label: string; href: "/app/profile" } };

export function TipButton({
  galleryId,
  curatorName,
  curatorHandle,
  isOwn,
  onTipped,
}: TipButtonProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  /**
   * Can the creator be paid at all?
   *
   * Checked before an amount is chosen rather than after Send. Tips go to the creator's own
   * wallet with no fallback, so a creator who never connected one cannot receive — and
   * finding that out at the end of the flow is a dead end wearing a working button.
   */
  const curatorReady = useQuery(api.stellar.external.curatorAcceptsTips, { galleryId });

  const external = useQuery(api.stellar.external.getMyExternalWallet);
  const freighter = useFreighter();

  const prepareTip = useAction(api.stellar.external.prepareTip);
  const submitTip = useAction(api.stellar.external.submitTip);
  const cancelPreparedTip = useMutation(api.stellar.external.cancelPreparedTip);

  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(DEFAULT_AMOUNT);
  const [sending, setSending] = React.useState(false);
  /**
   * The actual double-submit guard. `sending` drives the UI; this stops the second call.
   * Two taps inside one tick both read the pre-update `sending`, and on a phone a "double
   * tap" is exactly that. Here that is not a duplicate render, it is duplicate money.
   */
  const sendingRef = React.useRef(false);

  const selected = PRESETS.find((preset) => preset.amount === amount) ?? PRESETS[0]!;

  // Ordered by whose problem it is: the creator's setup, then the tipper's, then the
  // extension's. Each names one concrete next step rather than reporting a state.
  const blocker: Blocker | null =
    curatorReady === false
      ? {
          reason: `${curatorName ?? "This curator"} hasn't connected a wallet yet, so they can't receive tips.`,
        }
      : !external
        ? {
            reason: "Connect a wallet to tip.",
            action: { label: "Go to Profile", href: "/app/profile" },
          }
        : freighter.state === "unavailable"
          ? { reason: "Freighter isn't available in this browser. It's a desktop extension." }
          : freighter.state !== "connected"
            ? { reason: "Unlock Freighter to sign this tip." }
            : freighter.wrongNetwork
              ? {
                  reason: `Freighter is on ${freighter.network}. Switch it to ${EXPECTED_NETWORK}.`,
                }
              : null;

  const canSend = !blocker && !sending && curatorReady === true;

  /**
   * The tip, in three moves: the server builds and simulates, Freighter signs, the server
   * submits and polls.
   *
   * The XDR is opaque here in both directions — this component never learns what a
   * transaction contains. `submitTip` proves the envelope coming back hashes to the one it
   * built, so a modified transaction is rejected rather than recorded.
   */
  const sendTip = async (toastId: string | number): Promise<{ txHash: string }> => {
    if (!external) throw new FreighterError("WALLET_NOT_CONNECTED");

    const { tipId, xdr } = await prepareTip({ galleryId, amount: selected.amount });

    let signedXdr: string;
    try {
      signedXdr = await signWithFreighter(xdr, external.publicKey);
    } catch (error) {
      // Nothing was submitted, so the row we just created describes a tip that will never
      // happen. Release it, or the double-submit guard treats the user's own cancelled
      // attempt as a tip in flight and refuses their next one for a minute.
      await cancelPreparedTip({ tipId }).catch(() => {
        // Cleanup is best-effort; the pending window expires on its own. The signing
        // failure below is the one the user needs to hear about.
      });
      throw error;
    }

    toast.loading("Submitting to Stellar…", { id: toastId });
    return await submitTip({ tipId, signedXdr });
  };

  const handleConfirm = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);

    const toastId = toast.loading("Waiting for Freighter…");

    try {
      const { txHash } = await sendTip(toastId);

      // Close first: the toast is what confirms it, and on a phone a sheet still covering
      // the screen reads as "nothing happened".
      setOpen(false);
      toast.success(
        `Tipped ${selected.amount} USDC${curatorHandle ? ` to @${curatorHandle}` : ""}`,
        {
          id: toastId,
          duration: 10_000,
          description: "Confirmed on Stellar testnet.",
          action: {
            label: "View",
            // The receipt, one tap from the tip that produced it. A new tab keeps the app's
            // state intact when the user comes back — which matters most while recording.
            onClick: () =>
              window.open(txUrl(txHash, STELLAR_NETWORK), "_blank", "noopener,noreferrer"),
          },
        },
      );

      // The total belongs to the caller, because it comes from contract state rather than
      // from anything this component knows.
      onTipped?.();
    } catch (error) {
      // Declining the wallet popup is a decision, not a failure. Dismiss and leave the
      // sheet open on the amount they picked, so changing their mind again is one tap.
      if (error instanceof FreighterError && error.code === "SIGNATURE_REJECTED") {
        toast.dismiss(toastId);
      } else {
        toast.error(tipErrorMessage(error), { id: toastId });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // The contract rejects self-tips with `Error(Contract, #3)`, and there is no reason to
  // let someone discover that by tapping. Checked here rather than at the call site so the
  // next screen that wants a tip button cannot forget it.
  if (isOwn) return null;

  if (isLoading) {
    // Server render and the first client paint both land here, before the auth token has
    // resolved. Same button, inert: opening the sheet now means opening it for someone who
    // may turn out to be signed out a tick later, and watching it vanish underneath you is
    // worse than a button that is briefly unavailable.
    return (
      <Button disabled className="tap-target h-11 rounded-full px-5">
        <HandCoins className="size-4" />
        Tip
      </Button>
    );
  }

  if (!isAuthenticated) {
    // Signed out still sees the gallery and its on-chain total — only tipping needs a
    // session, and it asks for one rather than hiding.
    return (
      <Button asChild variant="secondary" className="tap-target h-11 rounded-full px-5">
        <Link href="/sign-in">
          <HandCoins className="size-4" />
          Tip
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="tap-target h-11 rounded-full px-5">
        <HandCoins className="size-4" />
        Tip
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={(next) => {
          // Dragging the sheet away mid-send would leave no sign of an in-flight
          // transaction beyond the toast. Cheaper to refuse the dismissal.
          if (sending) return;
          setOpen(next);
        }}
        title={curatorName ? `Tip ${curatorName}` : "Tip this curator"}
        description="Send testnet USDC through the TipJar contract on Stellar."
      >
        <div className="pb-safe px-5">
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((preset) => {
              const active = preset.amount === selected.amount;
              return (
                <button
                  key={preset.amount}
                  type="button"
                  aria-pressed={active}
                  disabled={sending || Boolean(blocker)}
                  onClick={() => setAmount(preset.amount)}
                  className={cn(
                    "tap-target flex h-14 items-center justify-center rounded-2xl border text-base font-semibold transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    "disabled:opacity-50",
                    active
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-muted/50 hover:bg-muted",
                  )}
                >
                  {preset.amount} USDC
                </button>
              );
            })}
          </div>

          <SourceLine publicKey={external?.publicKey ?? null} blocker={blocker} />

          <Button
            onClick={handleConfirm}
            disabled={!canSend}
            className="mt-4 h-12 w-full rounded-full text-base"
          >
            {sending ? "Sending…" : `Send ${selected.amount} USDC`}
          </Button>

          {blocker?.action ? (
            <Button asChild variant="ghost" className="mt-2 h-11 w-full rounded-full">
              <Link href={blocker.action.href}>{blocker.action.label}</Link>
            </Button>
          ) : null}

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Stellar testnet USDC. No real-value assets move.
          </p>
        </div>
      </ResponsiveModal>
    </>
  );
}

/**
 * What the tip will be spent from, or why it cannot be.
 *
 * Deliberately not a balance. We hold no key for this wallet and track no cache for it —
 * its balance is not ours to report, and Freighter shows it at signing time anyway. Naming
 * the address that will be debited is both honest and the more useful thing here.
 */
function SourceLine({ publicKey, blocker }: { publicKey: string | null; blocker: Blocker | null }) {
  if (blocker) {
    return <p className="mt-4 text-sm text-muted-foreground">{blocker.reason}</p>;
  }

  return (
    <p className="mt-4 text-sm text-muted-foreground">
      From{" "}
      <span className="font-mono text-xs font-medium text-foreground">
        {publicKey ? shorten(publicKey) : "—"}
      </span>{" "}
      via Freighter
    </p>
  );
}

/**
 * Turn whatever came back into something a person can read.
 *
 * The backend throws `ConvexError({ code, message })` precisely so nothing raw has to be
 * parsed here — it has already classified the failure, and its `message` is
 * `userMessageFor(code)`. The fallback still matters: a dropped connection between browser
 * and Convex never reaches that code path, and an unwrapped `Error` carries Horizon's XDR
 * vocabulary, which must never be shown to someone who just wanted to tip a dollar.
 */
function tipErrorMessage(error: unknown): string {
  // Raised in the browser rather than by the backend — the extension is missing, locked,
  // or on the wrong network — so it carries a code but never came through Convex.
  if (error instanceof FreighterError) return userMessageFor(error.code);

  if (error instanceof ConvexError) {
    const data = error.data as { code?: TipErrorCode; message?: string } | undefined;
    if (typeof data?.message === "string") return data.message;
    if (data?.code) return userMessageFor(data.code);
  }
  return userMessageFor("UNKNOWN");
}
