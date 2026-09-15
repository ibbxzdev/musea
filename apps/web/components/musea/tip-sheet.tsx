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
import { logError } from "@/lib/musea/debug";
import { PasskeyError, passkeysSupported, signWithPasskey } from "@/lib/musea/passkey";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";
import { cn } from "@/lib/utils";
import { ErrorDetail } from "./error-detail";
import { ResponsiveModal } from "./responsive-modal";

/**
 * The one-tap tip flow — the user-facing half of Deliverable 2.
 *
 * Tips are authorized by the user's own passkey — Face ID or Touch ID — and land in the
 * **gallery creator's** smart account. Musea holds no keys on either side: it can neither
 * spend for the tipper nor receive on the creator's behalf.
 *
 * **No Stellar code here.** This component knows a gallery id and an amount string. The
 * server builds, simulates and assembles the transaction and derives an auth digest; the
 * device signs those 32 bytes; the server submits. The browser never learns what it signed.
 * That is CLAUDE.md rule 1, and the lint rule is its backstop.
 *
 * **The Face ID call is synchronous inside the tap handler.** Safari consumes user
 * activation across an `await`, so `prepareTip` has to have returned the challenge before
 * the user commits — which is why the sheet prepares on open rather than on send.
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
  const curatorReady = useQuery(api.stellar.passkey.curatorAcceptsTips, { galleryId });

  const wallet = useQuery(api.stellar.passkey.getMyWallet);

  const prepareTip = useAction(api.stellar.tips.prepareTip);
  const submitTip = useAction(api.stellar.tips.submitTip);
  const cancelPreparedTip = useMutation(api.stellar.tips.cancelPreparedTip);

  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(DEFAULT_AMOUNT);
  const [sending, setSending] = React.useState(false);
  /**
   * The actual double-submit guard. `sending` drives the UI; this stops the second call.
   * Two taps inside one tick both read the pre-update `sending`, and on a phone a "double
   * tap" is exactly that. Here that is not a duplicate render, it is duplicate money.
   */
  const sendingRef = React.useRef(false);

  /**
   * The prepared tip, fetched when the sheet opens. Send is disabled until it lands — that
   * wait is what buys a Face ID prompt that actually appears on iPhone Safari.
   */
  const [prepared, setPrepared] = React.useState<{
    tipId: Id<"tips">;
    challenge: string;
    credentialId: string;
    rpId: string;
  } | null>(null);
  const [prepareError, setPrepareError] = React.useState<string | null>(null);
  /** Temporary: the raw last failure, rendered in the sheet for the device pass. */
  const [detail, setDetail] = React.useState<string | null>(null);

  const selected = PRESETS.find((preset) => preset.amount === amount) ?? PRESETS[0]!;

  // Ordered by whose problem it is: the creator's setup, then the tipper's, then the
  // device's. Each names one concrete next step rather than reporting a state.
  const blocker: Blocker | null =
    curatorReady === false
      ? {
          reason: `${curatorName ?? "This curator"} hasn't set up a wallet yet, so they can't receive tips.`,
        }
      : wallet === null || wallet?.status !== "deployed"
        ? {
            reason: "Set up your wallet to tip — one tap and Face ID.",
            action: { label: "Go to Profile", href: "/app/profile" },
          }
        : !passkeysSupported()
          ? { reason: "This browser can't use passkeys. Open Musea in Safari or Chrome." }
          : null;

  // Also gated on the challenge having arrived: Safari drops user activation across an
  // `await`, so Send must not be the thing that goes and fetches it.
  const canSend = !blocker && !sending && curatorReady === true && prepared !== null;

  /**
   * Prepare as soon as the sheet opens, and again whenever the amount changes.
   *
   * This is the load-bearing bit of the iPhone flow. `prepareTip` builds, simulates and
   * assembles the transaction and derives the auth digest — hundreds of milliseconds of
   * network work. Doing it after the Send tap would mean calling
   * `navigator.credentials.get()` on the far side of an `await`, and Safari has already
   * dropped user activation by then: no Face ID sheet, no error, nothing.
   *
   * So the challenge is in hand before the user commits, and Send is synchronous.
   */
  React.useEffect(() => {
    if (!open || blocker) return;

    let cancelled = false;
    setPrepared(null);
    setPrepareError(null);
    setDetail(null);
    prepareTip({ galleryId, amount: selected.amount })
      .then((result) => {
        if (cancelled) {
          // The sheet closed or the amount changed while this was in flight. Release the
          // row so the double-submit guard does not treat it as a tip still going through.
          void cancelPreparedTip({ tipId: result.tipId }).catch(() => {});
          return;
        }
        setPrepared(result);
      })
      .catch((error) => {
        const described = logError("prepareTip", error);
        if (!cancelled) {
          setPrepareError(tipErrorMessage(error));
          setDetail(described);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, blocker, galleryId, selected.amount, prepareTip, cancelPreparedTip]);

  const handleConfirm = async () => {
    if (sendingRef.current || !prepared) return;
    sendingRef.current = true;
    setSending(true);

    const toastId = toast.loading("Confirm with Face ID…");
    setDetail(null);

    try {
      // Synchronous inside the tap handler — the challenge is already here.
      const assertion = await signWithPasskey({
        challenge: prepared.challenge,
        credentialId: prepared.credentialId,
        rpId: prepared.rpId,
      });

      toast.loading("Submitting to Stellar…", { id: toastId });
      const { txHash } = await submitTip({ tipId: prepared.tipId, assertion });

      // Close first: the toast is what confirms it, and on a phone a sheet still covering
      // the screen reads as "nothing happened".
      setOpen(false);
      toast.success(
        `Tipped ${selected.amount} XLM${curatorHandle ? ` to @${curatorHandle}` : ""}`,
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
      // Nothing was submitted, so the prepared row describes a tip that will never happen.
      // Release it, or the guard treats the user's own cancelled attempt as one in flight.
      void cancelPreparedTip({ tipId: prepared.tipId }).catch(() => {});
      setPrepared(null);

      // Dismissing Face ID is a decision, not a failure: stay on the sheet, on the amount
      // they picked, so changing their mind again is one tap.
      const described = logError("submitTip", error);
      if (error instanceof PasskeyError && error.code === "SIGNATURE_REJECTED") {
        toast.dismiss(toastId);
      } else {
        setDetail(described);
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
        description="Send testnet XLM through the TipJar contract on Stellar."
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
                  {preset.amount} XLM
                </button>
              );
            })}
          </div>

          <SourceLine address={wallet?.contractAddress ?? null} blocker={blocker} />

          {/*
            A tip that cannot be built is refused here, before Face ID rather than after.
            `prepareTip` simulates, so this catches an insufficient balance or an
            unreachable curator while the user can still change the amount.
          */}
          {prepareError && !blocker ? (
            <p className="mt-2 text-sm text-destructive">{prepareError}</p>
          ) : null}

          <ErrorDetail detail={detail} />

          <Button
            onClick={handleConfirm}
            disabled={!canSend}
            className="mt-4 h-12 w-full rounded-full text-base"
          >
            {sending
              ? "Sending…"
              : !prepared && !blocker
                ? "Preparing…"
                : `Send ${selected.amount} XLM`}
          </Button>

          {blocker?.action ? (
            <Button asChild variant="ghost" className="mt-2 h-11 w-full rounded-full">
              <Link href={blocker.action.href}>{blocker.action.label}</Link>
            </Button>
          ) : null}

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Stellar testnet XLM. No real-value assets move.
          </p>
        </div>
      </ResponsiveModal>
    </>
  );
}

/**
 * What the tip will be spent from, or why it cannot be.
 *
 * Names the account that will be debited rather than showing a balance: the balance lives
 * on the profile, and repeating it here would be a second copy to drift.
 */
function SourceLine({ address, blocker }: { address: string | null; blocker: Blocker | null }) {
  if (blocker) {
    return <p className="mt-4 text-sm text-muted-foreground">{blocker.reason}</p>;
  }

  return (
    <p className="mt-4 text-sm text-muted-foreground">
      From{" "}
      <span className="font-mono text-xs font-medium text-foreground">
        {address ? shorten(address) : "—"}
      </span>{" "}
      with Face ID
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
  // Raised in the browser rather than by the backend — the device declined, or has no
  // passkey for this domain — so it carries a code but never came through Convex.
  if (error instanceof PasskeyError) return userMessageFor(error.code);

  if (error instanceof ConvexError) {
    const data = error.data as { code?: TipErrorCode; message?: string } | undefined;
    if (typeof data?.message === "string") return data.message;
    if (data?.code) return userMessageFor(data.code);
  }
  return userMessageFor("UNKNOWN");
}
