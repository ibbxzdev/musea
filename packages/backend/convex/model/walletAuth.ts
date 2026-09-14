import type { GenericCtx } from "@convex-dev/better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { GenericActionCtx } from "convex/server";
import * as z from "zod";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/**
 * "Continue with Freighter" — a Better Auth plugin for Stellar wallet sign-in.
 *
 * Two endpoints, the shape every wallet login has: ask for a challenge, send back a
 * signature. The cryptography is SEP-0010 and lives in `convex/stellar/webAuthNode.ts`.
 * This file is the session half — who a signature makes you, and how that becomes a cookie.
 *
 *   POST /stellar/nonce   { publicKey }             -> { challenge }
 *   POST /stellar/verify  { publicKey, signedXdr }  -> { success, user }
 *
 * **Why this is hand-written rather than better-auth's own `siwe` plugin.** That plugin is
 * Ethereum-shaped in two ways that cannot be configured away. It validates addresses
 * against a 42-character `0x` hex pattern and rejects a 56-character Stellar `G...` key
 * before its `verifyMessage` hook is ever reached; and it persists to a `walletAddress`
 * table that the Convex Better Auth component's schema does not contain. The
 * `verifyMessage` seam really is chain-agnostic — everything around it is not.
 *
 * **Why the `account` table and no new one.** The component ships a fixed schema — user,
 * account, session, verification, and a few OAuth tables — and an app cannot add to it.
 * That turns out to be the right shape anyway: a wallet is an authentication provider like
 * any other, so `providerId: "stellar"` with the public key as `accountId` says exactly
 * what it means, and inherits the component's existing `["accountId", "providerId"]` index.
 *
 * **No Stellar import here.** This module runs in Convex's default runtime, where
 * `@stellar/stellar-sdk` cannot load. It reaches the SDK only by `runAction` into a
 * `"use node"` action — which is what CLAUDE.md rule 1 asks for regardless of runtime.
 */

/** A `G...` Stellar public key: 56 chars, base32. The same shape `external.ts` enforces. */
const PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

/** Namespaced, so a challenge can never be consumed by some other flow's identifier. */
const verificationIdentifier = (publicKey: string) => `stellar-auth:${publicKey}`;

/**
 * Matches `CHALLENGE_TIMEOUT_SECONDS` in webAuthNode.ts.
 *
 * Two clocks govern one challenge — the transaction's own time bounds and this row's
 * `expiresAt` — and they have to agree. If the row outlived the transaction, a challenge
 * SEP-0010 has already rejected would still look live to the session layer.
 */
const CHALLENGE_TTL_MS = 300_000;

/**
 * The synthetic email a wallet-only user gets.
 *
 * Better Auth requires a unique email per user, and a wallet does not come with one. The
 * `.invalid` TLD is reserved by RFC 2606 precisely so that it can never resolve: this
 * address is unmistakably a placeholder, and no later "email your users" feature can
 * quietly try to deliver to it. Lowercased because Better Auth matches emails
 * case-insensitively.
 */
const syntheticEmail = (publicKey: string) => `${publicKey.toLowerCase()}@wallet.invalid`;

/** An address as a person reads it: enough of both ends to recognise, none of the middle. */
const shortAddress = (publicKey: string) => `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;

/**
 * What Freighter calls the network we are configured for.
 *
 * Read from the environment rather than `stellar/config.ts`, which is a `"use node"` module
 * and cannot be imported into this runtime. Only the label is needed here: the network a
 * signature actually commits to is fixed by the passphrase baked into the challenge, and is
 * checked where that signature is verified.
 */
const networkLabel = () =>
  (process.env.STELLAR_NETWORK?.trim() ?? "testnet") === "public" ? "PUBLIC" : "TESTNET";

/**
 * The Convex capabilities this plugin needs, proven present rather than assumed.
 *
 * `createAuth` is handed a `GenericCtx` because it is also constructed from queries and
 * mutations — `authComponent.getAuthUser` does exactly that. Only HTTP requests ever reach
 * an endpoint below, and those carry an action context, so this narrowing always succeeds
 * in practice. It is checked rather than cast so that if that ever stops being true, it
 * fails with a sentence instead of "undefined is not a function".
 */
function requireActionCtx(ctx: GenericCtx<DataModel>): GenericActionCtx<DataModel> {
  if (!("runAction" in ctx)) {
    throw new Error(
      "Stellar wallet sign-in needs an action context. These endpoints are reachable only " +
        "over HTTP, where one is always present - this means createAuth was invoked from a " +
        "query or mutation and an endpoint ran anyway.",
    );
  }
  return ctx as GenericActionCtx<DataModel>;
}

export function stellarWallet(ctx: GenericCtx<DataModel>) {
  return {
    id: "stellar-wallet",

    endpoints: {
      /**
       * Issue a challenge for this address to sign.
       *
       * Unauthenticated on purpose. Asking for a challenge is not a claim to be anyone, and
       * the answer is useless without the matching private key. The address is not checked
       * for existence on the network either: holding a key is independent of whether that
       * account was ever funded, and answering differently for the two would turn this into
       * an oracle for which addresses exist.
       */
      stellarNonce: createAuthEndpoint(
        "/stellar/nonce",
        {
          method: "POST",
          body: z.object({
            publicKey: z.string().regex(PUBLIC_KEY_RE, "Not a Stellar public key"),
          }),
        },
        async (endpointCtx) => {
          const { publicKey } = endpointCtx.body;
          const convex = requireActionCtx(ctx);

          const challenge: string = await convex.runAction(
            internal.stellar.webAuthNode.buildChallenge,
            { publicKey },
          );

          // Exactly one live challenge per address. Without this, asking twice leaves two
          // rows and `consumeVerificationValue` returns only the newest — so a user who
          // signs the challenge from the first popup is told their own signature is
          // invalid, which looks identical to an attack and is miserable to debug.
          await endpointCtx.context.internalAdapter.deleteVerificationByIdentifier(
            verificationIdentifier(publicKey),
          );

          await endpointCtx.context.internalAdapter.createVerificationValue({
            identifier: verificationIdentifier(publicKey),
            value: challenge,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          });

          return endpointCtx.json({ challenge });
        },
      ),

      /**
       * Check the signature, then be whoever it proves you are.
       *
       * The order matters: nothing about a user is read or written until the signature has
       * verified against a challenge this server issued and has now consumed.
       */
      stellarVerify: createAuthEndpoint(
        "/stellar/verify",
        {
          method: "POST",
          body: z.object({
            publicKey: z.string().regex(PUBLIC_KEY_RE, "Not a Stellar public key"),
            signedXdr: z.string().min(1),
          }),
          requireRequest: true,
        },
        async (endpointCtx) => {
          const { publicKey, signedXdr } = endpointCtx.body;
          const convex = requireActionCtx(ctx);
          const { internalAdapter } = endpointCtx.context;

          // Atomic and single-use: the first caller gets the row, everyone after gets null,
          // and an expired row reads as null too. A replayed signature therefore dies here,
          // before any of the session work below.
          const issued = await internalAdapter.consumeVerificationValue(
            verificationIdentifier(publicKey),
          );
          if (!issued) {
            throw new APIError("UNAUTHORIZED", {
              message: "That sign-in request expired. Try again.",
            });
          }

          const verified: boolean = await convex.runAction(
            internal.stellar.webAuthNode.verifyChallenge,
            { challengeXdr: issued.value, signedXdr, publicKey },
          );
          if (!verified) {
            throw new APIError("UNAUTHORIZED", {
              message: "That signature could not be verified.",
            });
          }

          // ── The signature is good. Past this line, the caller holds the key. ──────────

          // Identity comes from the `account` table and nowhere else. `externalWallets`
          // also maps addresses to users, but it is written by `external.ts:linkWallet`,
          // which takes an address from the client and proves nothing about who holds its
          // key. Adopting a user from that table would let anyone claim a stranger's
          // address and then collect their sign-ins. An `account` row, by contrast, is
          // only ever written a few lines below — after a signature has verified.
          const existing = await internalAdapter.findAccountByProviderId(publicKey, "stellar");

          let user = existing ? await internalAdapter.findUserById(existing.userId) : null;

          if (!user) {
            // The synthetic email is derived from the address, so it is guessable — which
            // means someone could register `<address>@wallet.invalid` through the ordinary
            // email sign-up form and sit on the name before that wallet's owner ever
            // arrives. They gain nothing (they still cannot produce a signature, and the
            // lookup above goes through the `account` table, not email), but without this
            // check `createUser` would fail on the duplicate and report a 500 for what is
            // really a taken name. Refuse deliberately, and say which address is affected.
            const squatted = await internalAdapter.findUserByEmail(syntheticEmail(publicKey));
            if (squatted) {
              throw new APIError("CONFLICT", {
                message: "An account already exists for this wallet address.",
              });
            }

            user = await internalAdapter.createUser({
              name: shortAddress(publicKey),
              email: syntheticEmail(publicKey),
              emailVerified: false,
            });

            await internalAdapter.linkAccount({
              userId: user.id,
              providerId: "stellar",
              accountId: publicKey,
            });
          }

          const session = await internalAdapter.createSession(user.id, false);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not start a session.",
            });
          }

          await setSessionCookie(endpointCtx, { session, user });

          // Signing in with a wallet *is* connecting it: the proof just given is strictly
          // stronger than what the connect-wallet button asks for. Doing it here means a
          // curator who arrives this way can receive tips immediately, with no second step
          // that asks for the same thing again.
          //
          // Its result is deliberately not gated on: the session above already exists, so a
          // failure to link must not surface as a failed sign-in. It returns false when the
          // profile row is not there yet, and connect-wallet remains the recovery path.
          await convex.runMutation(internal.stellar.internal.linkExternalWalletByAuthSubject, {
            authSubject: user.id,
            publicKey,
            network: networkLabel(),
          });

          return endpointCtx.json({
            success: true,
            user: { id: user.id, publicKey },
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
