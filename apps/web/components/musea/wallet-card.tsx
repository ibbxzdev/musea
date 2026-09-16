"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { formatXlm } from "@musea/shared/amounts";
import { type TipErrorCode, userMessageFor } from "@musea/shared/errors";
import { accountUrl, shorten } from "@musea/shared/stellar-links";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ExternalLink, Fingerprint, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorDetail } from "./error-detail";
import { logError } from "@/lib/musea/debug";
import { createPasskey, PasskeyError, passkeysSupported } from "@/lib/musea/passkey";
import { STELLAR_NETWORK } from "@/lib/musea/stellar";

/**
 * The wallet, on the profile (Story 2B.1).
 *
 * One tap creates a non-custodial Stellar smart account whose only signer is a passkey in
 * this device's Secure Enclave. Musea never sees a key — there is nothing here to leak,
 * which is the whole point of the model.
 *
 * **The tap handler calls `createPasskey` with options already in hand.** Safari consumes
 * user activation across an `await`, so fetching the challenge and *then* prompting would
 * mean the Face ID sheet never appears — silently. The options are fetched on mount and
 * refreshed after use, so a tap always has one ready.
 */
export function WalletCard() {
  const wallet = useQuery(api.stellar.passkey.getMyWallet);
  const startRegistration = useAction(api.stellar.passkey.startRegistration);
  const finishRegistration = useAction(api.stellar.passkey.finishRegistration);
  const getBalance = useAction(api.stellar.passkey.getMyBalance);
  const fundWallet = useAction(api.stellar.passkey.fundMyWallet);
  const forgetWallet = useAction(api.stellar.passkey.forgetWallet);

  const [options, setOptions] = React.useState<unknown>(null);
  const [creating, setCreating] = React.useState(false);
  const [balance, setBalance] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  /** Temporary: the raw last failure, rendered on the card for the device pass. */
  const [detail, setDetail] = React.useState<string | null>(null);
  const [funding, setFunding] = React.useState(false);

  const supported = React.useMemo(() => passkeysSupported(), []);
  const needsWallet = wallet === null || wallet?.status === "failed";

  // Keep a challenge ready so the tap handler never has to await one. Re-fetched after a
  // failed attempt, because a WebAuthn challenge is single-use.
  const prefetch = React.useCallback(() => {
    if (!supported) return;
    startRegistration({})
      .then(setOptions)
      .catch((error) => {
        // Was silent, which made a failing prefetch indistinguishable from a slow one:
        // the button just kept saying "Still getting ready".
        setOptions(null);
        setDetail(logError("startRegistration", error));
      });
  }, [startRegistration, supported]);

  React.useEffect(() => {
    if (needsWallet) prefetch();
  }, [needsWallet, prefetch]);

  const refreshBalance = React.useCallback(async () => {
    setRefreshing(true);
    try {
      setBalance(await getBalance({}));
    } catch (error) {
      // A balance we could not read is left as-is rather than shown as zero — claiming
      // someone holds nothing is worse than showing nothing. It is still recorded, though:
      // a balance read is a SAC simulation, so it failing says something about the account.
      setDetail(logError("getMyBalance", error));
    } finally {
      setRefreshing(false);
    }
  }, [getBalance]);

  React.useEffect(() => {
    if (wallet?.status === "deployed") void refreshBalance();
  }, [wallet?.status, refreshBalance]);

  /**
   * Detach an account that can no longer be connected, so a fresh one can be made.
   *
   * Nothing on-chain is touched — the contract keeps existing and keeps its balance, and
   * the passkey stays in the keychain. This only unlinks it from the profile. Offered only
   * for `needsReset`, because for a healthy wallet it would be a way to lose one.
   */
  const handleReset = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await forgetWallet({});
      setBalance(null);
      setDetail(null);
    } catch (error) {
      setDetail(logError("forgetWallet", error));
      toast.error(walletErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  /**
   * Fill a wallet that deployed but never funded.
   *
   * Its own control rather than something the balance refresh does silently: funding is a
   * network transaction, and a button that quietly moves money when you meant to reload a
   * number is the wrong shape even when the money is testnet XLM.
   */
  const handleFund = async () => {
    if (funding) return;
    setFunding(true);
    setDetail(null);
    const toastId = toast.loading("Adding testnet XLM…");
    try {
      const next = await fundWallet({});
      setBalance(next);
      toast.success("Wallet funded", { id: toastId });
    } catch (error) {
      setDetail(logError("fundMyWallet", error));
      toast.error(walletErrorMessage(error), { id: toastId });
    } finally {
      setFunding(false);
    }
  };

  const handleCreate = async () => {
    if (creating) return;
    if (!options) {
      toast.error("Still getting ready — try again in a second.");
      prefetch();
      return;
    }

    setCreating(true);
    setDetail(null);
    const toastId = toast.loading("Confirm with Face ID…");
    try {
      // Synchronous inside the tap: `options` is already resolved.
      const registrationResponse = await createPasskey(options);

      toast.loading("Creating your wallet on Stellar…", { id: toastId });
      const address = await finishRegistration({ registrationResponse });

      toast.success("Wallet ready", {
        id: toastId,
        description: `${shorten(address)} — funded with testnet XLM.`,
      });
      void refreshBalance();
    } catch (error) {
      // Dismissing Face ID is a decision, not a failure.
      const described = logError("finishRegistration", error);
      if (error instanceof PasskeyError && error.code === "SIGNATURE_REJECTED") {
        toast.dismiss(toastId);
      } else {
        setDetail(described);
        toast.error(walletErrorMessage(error), { id: toastId });
      }
      prefetch();
    } finally {
      setCreating(false);
    }
  };

  if (wallet === undefined) {
    return <div className="h-32 animate-pulse rounded-2xl border bg-muted/40" />;
  }

  if (!supported) {
    return (
      <div className="space-y-2 rounded-2xl border p-4">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Passkeys aren&apos;t available here</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Musea&apos;s wallet is secured by a passkey on your device. Open Musea in Safari or Chrome
          — some in-app browsers don&apos;t support it.
        </p>
      </div>
    );
  }

  if (needsWallet) {
    return (
      <div className="space-y-3 rounded-2xl border p-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="size-4" />
          <p className="text-sm font-medium">Set up your wallet</p>
        </div>
        <p className="text-sm text-muted-foreground">
          One tap creates a Stellar wallet held by this device. No seed phrase, no extension — your
          key is generated in the Secure Enclave and never leaves it. Musea can&apos;t touch it.
        </p>
        {wallet?.status === "failed" ? (
          <p className="text-sm text-destructive">
            Last attempt didn&apos;t finish. Tapping again picks up where it left off.
          </p>
        ) : null}
        <Button onClick={handleCreate} disabled={creating} className="tap-target w-full">
          {creating ? "Setting up…" : "Create wallet with Face ID"}
        </Button>
        <ErrorDetail detail={detail} />
      </div>
    );
  }

  if (wallet.needsReset) {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/40 p-4">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-destructive" />
          <p className="text-sm font-medium">This wallet needs to be replaced</p>
        </div>
        <p className="text-sm text-muted-foreground">
          It was created before Musea recorded everything needed to use it, so tipping and funding
          can&apos;t work. Making a new one takes one tap. The old wallet stays on Stellar and is
          empty.
        </p>
        <p className="font-mono text-xs text-muted-foreground">{shorten(wallet.contractAddress)}</p>
        <Button
          onClick={() => void handleReset()}
          disabled={creating}
          className="tap-target w-full"
        >
          {creating ? "Working…" : "Start over"}
        </Button>
        <ErrorDetail detail={detail} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-stellar" />
          <p className="text-sm font-medium">Your wallet</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="tap-target"
          onClick={() => void refreshBalance()}
          disabled={refreshing}
          aria-label="Refresh balance"
        >
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      <p className="text-2xl font-semibold tabular-nums">
        {balance === null ? "—" : `${formatXlm(BigInt(balance))} XLM`}
      </p>

      {balance === "0" ? (
        <Button
          onClick={() => void handleFund()}
          disabled={funding}
          variant="secondary"
          className="tap-target w-full"
        >
          {funding ? "Adding…" : "Add testnet XLM"}
        </Button>
      ) : null}

      <a
        href={accountUrl(wallet.contractAddress, STELLAR_NETWORK)}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground underline underline-offset-4"
      >
        {shorten(wallet.contractAddress)}
        <ExternalLink className="size-3" />
      </a>

      <p className="text-xs text-muted-foreground">
        Secured by a passkey on this device. Stellar testnet — no real-value assets.
      </p>

      <ErrorDetail detail={detail} />
    </div>
  );
}

/** The backend already classified the failure; this only has to unwrap it. */
function walletErrorMessage(error: unknown): string {
  if (error instanceof PasskeyError) return userMessageFor(error.code);
  if (error instanceof ConvexError) {
    const data = error.data as { code?: TipErrorCode; message?: string } | undefined;
    if (typeof data?.message === "string") return data.message;
    if (data?.code) return userMessageFor(data.code);
  }
  return userMessageFor("UNKNOWN");
}
