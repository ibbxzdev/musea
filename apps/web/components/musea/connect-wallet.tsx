"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { accountUrl, shorten } from "@musea/shared/stellar-links";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Link2, Link2Off, RefreshCw, TriangleAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  EXPECTED_NETWORK,
  EXPECTED_PASSPHRASE,
  FreighterError,
  requestFreighterAccess,
  useFreighter,
} from "@/lib/musea/freighter";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";
import { cn } from "@/lib/utils";

/**
 * Connect an external wallet — Freighter — on the profile.
 *
 * Deliberately additive. Every user still gets the managed wallet provisioned on sign-in;
 * connecting Freighter chooses which one a tip is spent from, and disconnecting silently
 * falls back to the managed one. Nothing here can leave a user unable to tip.
 *
 * When no provider is detected this renders an explanation plus a recheck, rather than a
 * dead button. That state means "not detected", which covers both a phone (where Freighter
 * has no build) and a desktop that has not installed it yet — we cannot tell those apart.
 */
export function ConnectWallet() {
  const freighter = useFreighter();
  const linked = useQuery(api.stellar.external.getMyExternalWallet);
  const linkWallet = useMutation(api.stellar.external.linkWallet);
  const unlinkWallet = useMutation(api.stellar.external.unlinkWallet);

  const [busy, setBusy] = React.useState(false);
  const [rechecking, setRechecking] = React.useState(false);

  // Detection retries on mount; this is the manual path for "I just installed it".
  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await freighter.refresh();
    } finally {
      setRechecking(false);
    }
  };

  /**
   * Keep the stored address in step with the extension.
   *
   * The user can switch accounts inside Freighter without touching this page, which would
   * otherwise leave us building transactions for an address they have moved off — the tip
   * would fail at signing with nothing on screen explaining why.
   */
  React.useEffect(() => {
    if (freighter.state !== "connected" || !freighter.address || !freighter.network) return;
    if (linked === undefined) return;
    if (linked?.publicKey === freighter.address) return;
    if (!linked) return; // Never link without an explicit tap; this only re-syncs.

    void linkWallet({ publicKey: freighter.address, network: freighter.network });
  }, [freighter.state, freighter.address, freighter.network, linked, linkWallet]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const info = await requestFreighterAccess();
      if (!info.address || !info.network) throw new FreighterError("WALLET_NOT_INSTALLED");

      if (info.wrongNetwork) {
        // Refuse the link rather than storing a mainnet address we will only reject later,
        // at the moment the user is trying to tip.
        //
        // Name what the wallet actually reported. "Switch to TESTNET" alone is useless to
        // someone who believes they already have — it gives them nothing to compare, and
        // no way to tell a wrong setting from a bug in this check.
        console.warn("[freighter] network mismatch", {
          reported: info.network,
          reportedPassphrase: info.networkPassphrase,
          expected: EXPECTED_NETWORK,
          expectedPassphrase: EXPECTED_PASSPHRASE,
        });
        toast.error(`Freighter is on ${info.network ?? "an unknown network"}.`, {
          description: `Switch it to ${EXPECTED_NETWORK} and connect again.`,
        });
        return;
      }

      await linkWallet({ publicKey: info.address, network: info.network });
      await freighter.refresh();
      toast.success(`Connected ${shorten(info.address)}`, {
        description: "Tips will be signed by Freighter.",
      });
    } catch (error) {
      if (error instanceof FreighterError && error.code === "SIGNATURE_REJECTED") return;
      toast.error(
        error instanceof FreighterError && error.code === "WALLET_NOT_INSTALLED"
          ? "Freighter isn't installed in this browser."
          : "Couldn't connect to Freighter.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await unlinkWallet();
      toast.success("Wallet disconnected", { description: "Tips use your Musea wallet again." });
    } finally {
      setBusy(false);
    }
  };

  // `checking` renders nothing rather than a skeleton: detection resolves in a tick, and a
  // control that appears then immediately changes shape is worse than one that arrives late.
  if (freighter.state === "checking" || linked === undefined) return null;

  return (
    <section className="mt-6">
      <h3 className="mb-2 ml-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        External wallet
      </h3>

      <div className="divide-y overflow-hidden rounded-2xl border">
        {linked ? (
          <>
            <a
              href={accountUrl(linked.publicKey, STELLAR_NETWORK)}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
            >
              <ExternalLink className="size-5 shrink-0 text-muted-foreground" />
              <span className="text-sm">Freighter</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {shorten(linked.publicKey)}
              </span>
            </a>

            {freighter.wrongNetwork ? (
              <p className="flex items-start gap-3 px-4 py-3 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlert className="mt-px size-4 shrink-0" />
                Freighter is on {freighter.network}. Switch it to {EXPECTED_NETWORK} to tip.
              </p>
            ) : null}

            <div className="px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={handleDisconnect}
                className="tap-target -ml-2 h-9 text-muted-foreground"
              >
                <Link2Off className="size-4" />
                Disconnect
              </Button>
            </div>
          </>
        ) : freighter.state === "unavailable" ? (
          // Deliberately "not detected" rather than "not available here". We cannot tell a
          // phone (where it never will be) from a desktop that simply has not installed it
          // yet, and asserting the wrong one of those sends a user who does have Freighter
          // looking for a bug in the extension.
          <div className="px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No Freighter detected. It&rsquo;s a{" "}
              <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                desktop browser extension
              </a>
              , so it won&rsquo;t appear on a phone. Your Musea wallet works everywhere and needs no
              setup.
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={rechecking}
              onClick={handleRecheck}
              className="tap-target -ml-2 mt-1 h-9 text-muted-foreground"
            >
              <RefreshCw className={cn("size-4", rechecking && "animate-spin")} />
              {rechecking ? "Checking…" : "Check again"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3">
            <Link2 className="size-5 shrink-0 text-muted-foreground" />
            <span className="text-sm">Connect Freighter</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={handleConnect}
              className="tap-target ml-auto h-9 rounded-full px-4"
            >
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}
      </div>

      <p className="mt-2 ml-4 text-xs text-muted-foreground">
        {linked
          ? "Tips are signed by Freighter and spent from this address."
          : "Optional. Without it, tips are spent from your Musea wallet."}
      </p>
    </section>
  );
}
