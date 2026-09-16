"use node";

import { randomBytes } from "node:crypto";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { stellarConfig } from "./config";

/**
 * WebAuthn verification for **sign-in** — the cryptography behind `model/passkeyAuth.ts`.
 *
 * This is deliberately a different job from `passkeyNode.ts`, which verifies nothing: there,
 * Smart Account Kit parses an attestation to derive a contract address, and the security
 * comes from the *contract* refusing a bad signature on-chain. Here there is no contract in
 * the loop — a verdict in this file is what mints a session, so it is the whole of the
 * security boundary and every check has to be done properly.
 *
 * **Which is why this uses `@simplewebauthn/server` rather than hand-rolled ECDSA.** The
 * signature check is the easy part; what actually stops attacks is everything around it —
 * that the challenge is the one we issued, that `clientDataJSON.origin` is an origin we
 * serve, that the RP ID hash matches, that the user-verification flag is set (so Face ID
 * genuinely happened rather than a mere presence tap), and that the type field says
 * `webauthn.get` and not `webauthn.create`. Each of those is a full authentication bypass
 * if omitted, and none of them is obvious from the outside. This is not the place to save
 * a dependency.
 *
 * Pinned to 13.x to match `@simplewebauthn/browser` in `apps/web`. The two halves share a
 * wire format and are versioned together.
 */

/**
 * How long a sign-in challenge stays valid.
 *
 * A human has to notice the Face ID sheet and authenticate, so this is generous — it bounds
 * replay, not user patience. The verification row's own `expiresAt` is set from the same
 * constant in `model/passkeyAuth.ts`; two clocks governing one challenge have to agree, or
 * a challenge one layer has already rejected still looks live to the other.
 */
export const CHALLENGE_TTL_MS = 300_000;

/** A fresh challenge. 32 bytes from the system CSPRNG, base64url for the wire. */
export function newChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export const createChallenge = internalAction({
  args: {},
  returns: v.string(),
  handler: async () => newChallenge(),
});

/**
 * Registration options for a brand-new account.
 *
 * **The WebAuthn user handle is random, not a Convex user id.** No user exists yet — this
 * is sign-up — and that is the point: nothing is created in the database until an
 * attestation has verified, so an anonymous caller cannot mint user rows by asking for
 * options. It also means the handle carries no personal data into the OS passkey list.
 *
 * `residentKey: "required"` is load-bearing for sign-in. A discoverable credential is what
 * lets the device offer the right passkey when the user has typed nothing at all — with a
 * non-resident key we would need to know who they are before they could prove it.
 *
 * `alg: -7` is ES256 (secp256r1), the only algorithm Soroban's on-chain verifier knows.
 * Offering anything else could produce a credential that logs in fine and can never sign a
 * tip, which is the same physical passkey failing at half its job.
 */
export const buildSignUpOptions = internalAction({
  args: { displayName: v.string() },
  handler: async (_ctx, { displayName }) => {
    const cfg = stellarConfig();
    return {
      challenge: newChallenge(),
      rp: { id: cfg.rpId, name: "Musea" },
      user: {
        id: randomBytes(32).toString("base64url"),
        name: displayName,
        displayName,
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" as const }],
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const,
        residentKey: "required" as const,
        userVerification: "required" as const,
      },
      timeout: 60_000,
      attestation: "none" as const,
    };
  },
});

/**
 * Check a registration attestation and pull out what identifies the credential.
 *
 * Returns the credential id and COSE public key on success. On failure it returns a reason
 * rather than throwing, because the caller has to turn this into an HTTP status and a
 * sentence for a human — and an exception crossing the `runAction` boundary arrives as an
 * opaque server error with the actual cause buried in a log.
 */
export const verifyRegistration = internalAction({
  args: { response: v.any(), expectedChallenge: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      credentialId: v.string(),
      publicKey: v.string(),
      counter: v.number(),
      rpId: v.string(),
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (_ctx, { response, expectedChallenge }) => {
    const cfg = stellarConfig();
    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: cfg.allowedOrigins,
        expectedRPID: cfg.rpId,
        // Face ID, not a mere presence tap. The whole product claim is that a tip is
        // authorized by the user's face; a session minted without it would undercut that
        // before the user ever reaches a tip sheet.
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return { ok: false as const, reason: "The passkey could not be verified." };
      }

      const { credential } = verification.registrationInfo;
      return {
        ok: true as const,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        rpId: cfg.rpId,
      };
    } catch (error) {
      console.error(`[musea] passkey registration verification failed: ${detail(error)}`);
      return { ok: false as const, reason: "The passkey could not be verified." };
    }
  },
});

/**
 * Check a sign-in assertion against a stored credential.
 *
 * `counter` comes back so the caller can persist it. It is recorded rather than enforced:
 * Apple's Secure Enclave reports 0 on every assertion and never increments, so rejecting a
 * non-increasing counter would lock out every iPhone — the demo's target device. See the
 * note on `passkeyCredentials.counter`.
 */
export const verifyAssertion = internalAction({
  args: {
    response: v.any(),
    expectedChallenge: v.string(),
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), counter: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (_ctx, { response, expectedChallenge, credentialId, publicKey, counter }) => {
    const cfg = stellarConfig();
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: cfg.allowedOrigins,
        expectedRPID: cfg.rpId,
        requireUserVerification: true,
        credential: {
          id: credentialId,
          publicKey: new Uint8Array(Buffer.from(publicKey, "base64url")),
          counter,
        },
      });

      if (!verification.verified) {
        return { ok: false as const, reason: "That signature could not be verified." };
      }
      return { ok: true as const, counter: verification.authenticationInfo.newCounter };
    } catch (error) {
      console.error(`[musea] passkey assertion verification failed: ${detail(error)}`);
      return { ok: false as const, reason: "That signature could not be verified." };
    }
  },
});

/** Server-side only. Never returned to a browser — a verification failure stays vague. */
function detail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
