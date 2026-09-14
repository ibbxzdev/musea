"use client";

import { authClient } from "@/lib/auth-client";
import { FreighterError, requestFreighterAccess, signWithFreighter } from "./freighter";

/**
 * Sign in — or sign up — by proving you hold a Stellar wallet's key.
 *
 * Four steps, and the middle two are the point:
 *
 *   1. Ask Freighter for access, which gives us the address.
 *   2. Ask our server for a SEP-0010 challenge built for that address.
 *   3. Have Freighter sign it.
 *   4. Send the signature back; the server checks it and sets a session cookie.
 *
 * **The user is not authorising a payment.** The challenge transaction carries sequence
 * number 0, which is never valid on the network, so the thing being signed cannot be
 * submitted by us or by anyone who intercepts it. Freighter will still show a transaction
 * approval popup — that is the only UI it has — so the button copy around this needs to
 * make clear that nothing moves.
 *
 * There is no separate "sign up": a wallet the server has never seen becomes a new
 * account, and one it has seen signs back into the existing one. That is the same
 * behaviour every wallet login has, and it is why the button says "Continue".
 *
 * Throws `FreighterError` for anything the extension reports, so callers can render the
 * same `TipErrorCode` messages the tipping flow uses. Server-side rejections surface as
 * `WALLET_NOT_CONNECTED`, since by then the only way to recover is to start over.
 */
export async function signInWithFreighter(): Promise<{ publicKey: string }> {
  // Prompts if this site is not yet authorised. Must be called from a user gesture.
  const info = await requestFreighterAccess();

  if (!info.address) {
    throw new FreighterError("WALLET_NOT_CONNECTED", "no address after requestAccess");
  }

  // Checked before we build anything. A challenge is bound to a network passphrase, so a
  // wallet on the wrong network would produce a signature that cannot verify — which would
  // arrive as "signature invalid" and read like a bug rather than a wrong toggle.
  if (info.wrongNetwork) {
    throw new FreighterError("WALLET_NETWORK_MISMATCH", `wallet on ${info.network}`);
  }

  const publicKey = info.address;

  const nonce = await authClient.stellar.nonce({ publicKey });
  if (nonce.error || !nonce.data?.challenge) {
    throw new FreighterError("WALLET_NOT_CONNECTED", nonce.error?.message ?? "no challenge");
  }

  // Re-reads the network and compares the returned `signerAddress`, so switching account or
  // network while the popup is open is caught here rather than becoming a failed verify.
  const signedXdr = await signWithFreighter(nonce.data.challenge, publicKey);

  const verified = await authClient.stellar.verify({ publicKey, signedXdr });
  if (verified.error || !verified.data?.success) {
    throw new FreighterError("WALLET_NOT_CONNECTED", verified.error?.message ?? "verify failed");
  }

  return { publicKey };
}
