import type { GenericCtx } from "@convex-dev/better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { GenericActionCtx } from "convex/server";
import * as z from "zod";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/**
 * "Continue with Face ID" — passkey sign-in, and the only way into Musea.
 *
 * Four endpoints, the shape every passkey login has: ask for a challenge, send back an
 * assertion. The cryptography is in `stellar/passkeyAuthNode.ts`; this file is the session
 * half — who an assertion makes you, and how that becomes a cookie.
 *
 *   POST /passkey/sign-up-options   { displayName }        -> { options }
 *   POST /passkey/sign-up-verify    { response, ... }      -> { success, user }
 *   POST /passkey/sign-in-options   {}                     -> { challenge, rpId }
 *   POST /passkey/sign-in-verify    { response }           -> { success, user }
 *
 * **Why this is hand-written rather than better-auth's own `passkey` plugin.** That plugin
 * persists to a `passkey` table, and the Convex Better Auth component ships a fixed schema
 * — user, account, session, verification, jwks, rateLimit and a few OAuth tables — that an
 * app cannot add to. This is the identical wall the deleted SEP-0010 sign-in hit with the
 * `siwe` plugin's `walletAddress` table, and the answer is the same one: the credential
 * lives in our own `passkeyCredentials` table, and *identity* lives in the component's
 * `account` table as `providerId: "passkey"`, which inherits its existing
 * `["accountId", "providerId"]` index and says exactly what it means.
 *
 * **One passkey, two jobs.** The credential registered here is the same one that authorizes
 * tips — one Face ID enrolment is both the login and the smart account's on-chain signer.
 * That is why sign-up hands its attestation on to wallet provisioning instead of asking the
 * user to enrol a second time.
 *
 * **No Stellar import here.** This module runs in Convex's default runtime, where
 * `@stellar/stellar-sdk` cannot load. It reaches crypto only by `runAction` into a
 * `"use node"` module, which is what docs/architecture.md rule 1 asks for regardless of runtime.
 *
 * ## The two failure modes worth knowing before changing anything
 *
 * - **A verdict in `stellar/passkeyAuthNode.ts` is the entire security boundary.** Unlike a
 *   tip — where a bad signature is caught on-chain by the smart account's `__check_auth` —
 *   nothing downstream re-checks a session. Do not move verification out of that module or
 *   weaken `requireUserVerification`.
 * - **Safari consumes user activation across an `await`.** Every `/…-options` endpoint
 *   exists so the browser can hold a challenge *before* the user taps. Collapsing options
 *   and verify into one round trip would make the Face ID sheet silently never appear on
 *   the demo's target device.
 */

/**
 * Matches `CHALLENGE_TTL_MS` in `stellar/passkeyAuthNode.ts`.
 *
 * Two clocks govern one challenge — this row's `expiresAt` and the window a human needs to
 * authenticate. If the row outlived the intended window, a challenge that should be stale
 * would still look live to the session layer.
 */
const CHALLENGE_TTL_MS = 300_000;

/**
 * Challenge rows, namespaced by flow so a sign-up challenge can never be redeemed by the
 * sign-in endpoint or vice versa — the two make different guarantees about what a verified
 * response means.
 *
 * **Both are keyed by the challenge itself, not by a user or a constant.** Neither endpoint
 * knows who is calling: sign-in deliberately cannot (that is what a discoverable credential
 * buys), and at sign-up there is no user yet. A shared constant would mean one global
 * in-flight registration for the entire deployment — two people signing up seconds apart
 * would delete each other's row, and the first to reach Face ID would be told their own
 * brand-new passkey had expired. That is precisely the two-window recording SOW §4.2 asks
 * for, so it would have surfaced on camera.
 *
 * The key being guessable costs nothing: the security is that the challenge is inside the
 * signed `clientDataJSON` and that the row is consumed on first use, not that the lookup
 * key is a secret.
 */
const signUpIdentifier = (nonce: string) => `passkey-signup:${nonce}`;
const signInIdentifier = (nonce: string) => `passkey-signin:${nonce}`;

/**
 * The synthetic email a passkey-only user gets.
 *
 * Better Auth requires a unique email per user and a passkey does not come with one. The
 * `.invalid` TLD is reserved by RFC 2606 precisely so it can never resolve: this address is
 * unmistakably a placeholder, and no later "email your users" feature can quietly try to
 * deliver to it.
 *
 * Derived from the credential id, which is unique per credential, so two users can never
 * collide. Unlike the SEP-0010 version this cannot be squatted through a sign-up form —
 * there is no longer an email sign-up form to squat it with.
 */
const syntheticEmail = (credentialId: string) =>
  `${credentialId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40)}@passkey.invalid`;

/**
 * The Convex capabilities this plugin needs, proven present rather than assumed.
 *
 * `createAuth` is handed a `GenericCtx` because it is also constructed from queries and
 * mutations — `authComponent.getAuthUser` does exactly that. Only HTTP requests reach an
 * endpoint below, and those carry an action context, so this narrowing always succeeds in
 * practice. It is checked rather than cast so that if that stops being true it fails with a
 * sentence instead of "undefined is not a function".
 */
function requireActionCtx(ctx: GenericCtx<DataModel>): GenericActionCtx<DataModel> {
  if (!("runAction" in ctx)) {
    throw new Error(
      "Passkey sign-in needs an action context. These endpoints are reachable only over " +
        "HTTP, where one is always present - this means createAuth was invoked from a " +
        "query or mutation and an endpoint ran anyway.",
    );
  }
  return ctx as GenericActionCtx<DataModel>;
}

export function passkeyAuth(ctx: GenericCtx<DataModel>) {
  return {
    id: "passkey-auth",

    endpoints: {
      /**
       * Options for enrolling a new passkey.
       *
       * Unauthenticated, and deliberately creates nothing. Asking for options is not a
       * claim to be anyone, and the options are useless without an authenticator that will
       * answer them — so no user row exists until `signUpVerify` has checked an attestation.
       */
      passkeySignUpOptions: createAuthEndpoint(
        "/passkey/sign-up-options",
        {
          method: "POST",
          body: z.object({
            displayName: z.string().trim().min(1).max(60).optional(),
          }),
        },
        async (endpointCtx) => {
          const convex = requireActionCtx(ctx);
          const displayName = endpointCtx.body.displayName?.trim() || "Musea curator";

          const options = await convex.runAction(
            internal.stellar.passkeyAuthNode.buildSignUpOptions,
            { displayName },
          );

          // One row per challenge, so concurrent sign-ups on different devices cannot
          // consume each other's. The display name rides along because it has to survive
          // to the verify call: it is what the user typed, and re-reading it from the
          // client there would let anyone register under a name they never entered.
          await endpointCtx.context.internalAdapter.createVerificationValue({
            identifier: signUpIdentifier(options.challenge),
            value: JSON.stringify({ challenge: options.challenge, displayName }),
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          });

          return endpointCtx.json({ options });
        },
      ),

      /**
       * Check the attestation, then create the account it proves.
       *
       * The order matters: nothing about a user is read or written until the attestation has
       * verified against a challenge this server issued and has now consumed.
       */
      passkeySignUpVerify: createAuthEndpoint(
        "/passkey/sign-up-verify",
        {
          method: "POST",
          body: z.object({ response: z.any(), challenge: z.string().min(1) }),
          requireRequest: true,
        },
        async (endpointCtx) => {
          const convex = requireActionCtx(ctx);
          const { internalAdapter } = endpointCtx.context;

          // Atomic and single-use: the first caller gets the row, everyone after gets null,
          // and an expired row reads as null too. A replayed attestation dies here, before
          // any of the user work below.
          const issued = await internalAdapter.consumeVerificationValue(
            signUpIdentifier(endpointCtx.body.challenge),
          );
          if (!issued) {
            throw new APIError("UNAUTHORIZED", {
              message: "That sign-up request expired. Try again.",
            });
          }
          const { challenge, displayName } = JSON.parse(issued.value) as {
            challenge: string;
            displayName: string;
          };

          const verified = await convex.runAction(
            internal.stellar.passkeyAuthNode.verifyRegistration,
            { response: endpointCtx.body.response, expectedChallenge: challenge },
          );
          if (!verified.ok) {
            throw new APIError("UNAUTHORIZED", { message: verified.reason });
          }

          // ── The attestation is good. Past this line, the caller holds the key. ────────

          // A credential id is a public handle, not a secret, so an existing one must never
          // be adopted onto a new user — that would be a complete account takeover by
          // replaying someone else's public identifier. Send them to sign-in instead.
          const taken = await internalAdapter.findAccountByProviderId(
            verified.credentialId,
            "passkey",
          );
          if (taken) {
            throw new APIError("CONFLICT", {
              message: "That passkey already has an account. Try signing in instead.",
            });
          }

          const user = await internalAdapter.createUser({
            name: displayName,
            email: syntheticEmail(verified.credentialId),
            emailVerified: false,
          });

          await internalAdapter.linkAccount({
            userId: user.id,
            providerId: "passkey",
            accountId: verified.credentialId,
          });

          const recorded = await convex.runMutation(internal.passkeys.recordCredential, {
            authSubject: user.id,
            credentialId: verified.credentialId,
            publicKey: verified.publicKey,
            rpId: verified.rpId,
            counter: verified.counter,
          });
          if (!recorded.ok) {
            // The account row above says who this credential is, but without the stored
            // public key nothing can ever *verify* them again — the user would be created
            // and permanently unable to sign in. Fail loudly instead.
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not finish creating your account. Please try again.",
            });
          }

          const session = await internalAdapter.createSession(user.id, false);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not start a session.",
            });
          }
          await setSessionCookie(endpointCtx, { session, user });

          // The wallet, from the same enrolment, after the response goes out. See
          // `passkeys.provisionWalletForSubject` for why this is scheduled rather than
          // awaited — and note its result is deliberately not gated on: the session already
          // exists, so a relayer hiccup must not surface as a failed sign-up.
          await convex.scheduler.runAfter(0, internal.passkeys.provisionWalletForSubject, {
            authSubject: user.id,
            registrationResponse: endpointCtx.body.response,
          });

          return endpointCtx.json({ success: true, user: { id: user.id } });
        },
      ),

      /**
       * A challenge to sign in with.
       *
       * Takes no identifier at all — not an email, not a credential id. The credential is
       * discoverable (`residentKey: "required"`), so the device offers the right passkey on
       * its own and the server learns who it is only from the assertion. That is better
       * than asking: an endpoint that answered differently for known and unknown users
       * would be an oracle for which accounts exist.
       */
      passkeySignInOptions: createAuthEndpoint(
        "/passkey/sign-in-options",
        { method: "POST" },
        async (endpointCtx) => {
          const convex = requireActionCtx(ctx);
          const challenge = await convex.runAction(
            internal.stellar.passkeyAuthNode.createChallenge,
            {},
          );

          // Keyed by the challenge itself, so concurrent sign-ins on different devices
          // cannot consume each other's row. The browser hands the nonce back untouched;
          // it is a lookup key, and the security comes from the challenge being inside the
          // signed `clientDataJSON`, not from the key being unguessable.
          await endpointCtx.context.internalAdapter.createVerificationValue({
            identifier: signInIdentifier(challenge),
            value: challenge,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          });

          return endpointCtx.json({ challenge });
        },
      ),

      /**
       * Check the assertion, then be whoever it proves you are.
       */
      passkeySignInVerify: createAuthEndpoint(
        "/passkey/sign-in-verify",
        {
          method: "POST",
          body: z.object({ response: z.any(), challenge: z.string().min(1) }),
          requireRequest: true,
        },
        async (endpointCtx) => {
          const convex = requireActionCtx(ctx);
          const { internalAdapter } = endpointCtx.context;
          const { response, challenge } = endpointCtx.body;

          const issued = await internalAdapter.consumeVerificationValue(
            signInIdentifier(challenge),
          );
          if (!issued) {
            throw new APIError("UNAUTHORIZED", {
              message: "That sign-in request expired. Try again.",
            });
          }

          const credentialId = typeof response?.id === "string" ? response.id : null;
          if (!credentialId) {
            throw new APIError("BAD_REQUEST", { message: "That passkey response is malformed." });
          }

          const stored = await convex.runQuery(internal.passkeys.getCredential, { credentialId });

          // Deliberately the same message as a failed signature. Distinguishing "no such
          // credential" from "bad signature" would turn this endpoint into a probe for
          // which credentials are registered here.
          const refuse = () =>
            new APIError("UNAUTHORIZED", { message: "That passkey could not be verified." });
          if (!stored) throw refuse();

          const verified = await convex.runAction(
            internal.stellar.passkeyAuthNode.verifyAssertion,
            {
              response,
              expectedChallenge: issued.value,
              credentialId: stored.credentialId,
              publicKey: stored.publicKey,
              counter: stored.counter,
            },
          );
          if (!verified.ok) throw refuse();

          // ── The assertion is good. Past this line, the caller holds the key. ──────────

          // Identity comes from the `account` table and nowhere else. `passkeyCredentials`
          // also maps credentials to users, but its job is to hold the key material used to
          // *check* a signature; resolving identity from it as well would collapse the
          // authenticator and the identity store into one row, so a single bad write would
          // be both a forged key and a forged identity.
          const account = await internalAdapter.findAccountByProviderId(credentialId, "passkey");
          if (!account) throw refuse();

          const user = await internalAdapter.findUserById(account.userId);
          if (!user) throw refuse();

          await convex.runMutation(internal.passkeys.touchCredential, {
            credentialId,
            counter: verified.counter,
          });

          const session = await internalAdapter.createSession(user.id, false);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not start a session.",
            });
          }
          await setSessionCookie(endpointCtx, { session, user });

          return endpointCtx.json({ success: true, user: { id: user.id } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
