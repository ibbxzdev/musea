"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { TipErrorCode } from "@musea/shared/errors";

/**
 * WebAuthn — the browser's entire cryptographic role (Story 2B.3).
 *
 * **This is the one place client code touches crypto, and it imports no Stellar package.**
 * `navigator.credentials` is a browser platform API, not a blockchain library: the device
 * is handed 32 bytes and returns a signature over them. It never learns what those bytes
 * mean, never builds a transaction, and never sees an address. That is what keeps
 * CLAUDE.md rule 1 intact while the wallet is genuinely non-custodial — and why the ESLint
 * rule permits `@simplewebauthn/browser` while blocking `smart-account-kit`, which would
 * drag the whole Stellar SDK into the bundle to do the same job.
 *
 * ## The rule that breaks this on iPhone
 *
 * **Safari consumes user activation across an `await`.** Fetch the challenge first and
 * *then* call `startAuthentication()`, and the call happens outside the tap gesture: the
 * Face ID sheet silently never appears, with no error to catch. Every function here must
 * therefore be called with its challenge already in hand, synchronously inside the tap
 * handler. The two-action backend split exists to make that possible — `prepareTip`
 * returns the challenge before the user commits to sending.
 */

/** Raised in the browser, so it carries a shared code but never came through Convex. */
export class PasskeyError extends Error {
  constructor(readonly code: TipErrorCode) {
    super(code);
    this.name = "PasskeyError";
  }
}

/**
 * Whether this browser can do passkeys at all.
 *
 * `PublicKeyCredential` is absent in some in-app browsers (Instagram, TikTok) and on old
 * iOS. Checking lets the UI say so instead of rendering a button that does nothing.
 */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    // A secure context is required. `localhost` is the only exempt origin, which is why
    // testing over a LAN IP fails here rather than at the prompt.
    window.isSecureContext
  );
}

/**
 * Create a passkey. Call inside the tap handler with `options` already fetched.
 *
 * Returns the raw response for the server to extract the P-256 key from. Nothing is
 * derived here — the browser's job ends at "the authenticator said yes".
 */
export async function createPasskey(options: unknown): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeyError("PASSKEY_UNSUPPORTED");
  try {
    return await startRegistration({
      optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
  } catch (error) {
    throw new PasskeyError(classify(error, "PASSKEY_PROVISIONING_FAILED"));
  }
}

/**
 * Sign a challenge with an existing passkey. Call inside the tap handler.
 *
 * `challenge` is the Soroban auth digest, base64url. `allowCredentials` pins the specific
 * credential so the device does not offer an unrelated passkey for this domain.
 */
export async function signWithPasskey(args: {
  challenge: string;
  credentialId: string;
  rpId: string;
}): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeyError("PASSKEY_UNSUPPORTED");
  try {
    return await startAuthentication({
      optionsJSON: {
        challenge: args.challenge,
        rpId: args.rpId,
        userVerification: "required",
        timeout: 60_000,
        allowCredentials: [{ id: args.credentialId, type: "public-key" }],
      } as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
  } catch (error) {
    throw new PasskeyError(classify(error, "PASSKEY_AUTH_REJECTED"));
  }
}

/**
 * Turn a DOMException into one of our codes.
 *
 * `NotAllowedError` is overwhelmingly the user dismissing the sheet — a decision, not a
 * failure — so it maps to SIGNATURE_REJECTED and the UI stays silent about it. The
 * browser deliberately does not distinguish "cancelled" from "no matching credential",
 * to avoid leaking which credentials a device holds; that ambiguity is the spec working
 * as intended, not something to defeat.
 */
function classify(error: unknown, fallback: TipErrorCode): TipErrorCode {
  if (error instanceof PasskeyError) return error.code;
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "SIGNATURE_REJECTED";
  if (name === "SecurityError") return "PASSKEY_RP_MISMATCH";
  if (name === "NotSupportedError") return "PASSKEY_UNSUPPORTED";
  if (name === "InvalidStateError") return "PASSKEY_NOT_REGISTERED";
  return fallback;
}
