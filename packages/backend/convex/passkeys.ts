import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

/**
 * Database helpers for passkey sign-in.
 *
 * Every function here is `internal*` and none is reachable from a client. The only callers
 * are the Better Auth plugin in `model/passkeyAuth.ts` and the scheduled provisioning
 * below — which matters more than usual, because a public mutation that could write
 * `passkeyCredentials` would let anyone register their own device against someone else's
 * account and then sign in as them. There is deliberately no public write path.
 *
 * Default runtime: this file touches only the database. The cryptography lives in
 * `stellar/passkeyAuthNode.ts`, which is `"use node"`.
 */

/** The stored credential a sign-in assertion claims to be, or null if we've never seen it. */
export const getCredential = internalQuery({
  args: { credentialId: v.string() },
  handler: async (ctx, { credentialId }) => {
    return await ctx.db
      .query("passkeyCredentials")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
      .unique();
  },
});

/** Resolve a Better Auth subject to the Musea profile row the triggers created for it. */
export const getUserIdByAuthSubject = internalQuery({
  args: { authSubject: v.string() },
  handler: async (ctx, { authSubject }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", authSubject))
      .unique();
    return user ? { userId: user._id, name: user.name } : null;
  },
});

/**
 * Record a freshly registered credential.
 *
 * Write-once on the credential id. A credential that already has an owner is never
 * re-pointed at a different user: doing so would be a complete account takeover, and the
 * WebAuthn spec gives no guarantee that a credential id is unguessable — it is a handle,
 * not a secret. Registration verifies the attestation first, so reaching here means the
 * device genuinely produced this key; it does not mean the caller should inherit whoever
 * already holds it.
 */
export const recordCredential = internalMutation({
  args: {
    authSubject: v.string(),
    credentialId: v.string(),
    publicKey: v.string(),
    rpId: v.string(),
    counter: v.number(),
  },
  returns: v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false) })),
  handler: async (ctx, { authSubject, credentialId, publicKey, rpId, counter }) => {
    const existing = await ctx.db
      .query("passkeyCredentials")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
      .unique();
    if (existing) return { ok: false as const };

    const user = await ctx.db
      .query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", authSubject))
      .unique();
    if (!user) return { ok: false as const };

    await ctx.db.insert("passkeyCredentials", {
      userId: user._id,
      credentialId,
      publicKey,
      rpId,
      counter,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Note that a credential was just used.
 *
 * The counter is stored, never enforced — Apple's Secure Enclave reports 0 forever, so a
 * monotonicity check would lock out every iPhone. `lastUsedAt` is the useful half: it is
 * how an abandoned credential is distinguishable from an active one.
 */
export const touchCredential = internalMutation({
  args: { credentialId: v.string(), counter: v.number() },
  returns: v.null(),
  handler: async (ctx, { credentialId, counter }) => {
    const row = await ctx.db
      .query("passkeyCredentials")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
      .unique();
    if (row) await ctx.db.patch(row._id, { counter, lastUsedAt: Date.now() });
    return null;
  },
});

/**
 * Give a brand-new account its smart wallet, from the credential it just signed up with.
 *
 * **Scheduled rather than awaited inside sign-up, and that is the whole design.**
 * Provisioning is four network round trips — derive, deploy through the relayer, confirm,
 * fund — and any of them can fail or simply be slow. Holding the sign-up response open for
 * it would mean a new user staring at a spinner on the one screen where nothing has gone
 * wrong yet, and a relayer hiccup would present as "sign-up failed" for an account that
 * was in fact created.
 *
 * So the session is minted the moment the attestation verifies, and this runs after. The
 * user lands in the app immediately; the wallet card shows its own progress and already
 * knows how to resume, because `provisionSmartAccount` is idempotent and was written for
 * exactly this retry path.
 *
 * One Face ID enrolment, two jobs: the same credential is the login and the wallet's
 * on-chain signer. The attestation is passed through because Smart Account Kit derives the
 * contract address from it — nothing secret crosses here, an attestation is a public key
 * plus metadata.
 */
export const provisionWalletForSubject = internalAction({
  args: { authSubject: v.string(), registrationResponse: v.any() },
  returns: v.null(),
  handler: async (ctx, { authSubject, registrationResponse }) => {
    const profile = await ctx.runQuery(internal.passkeys.getUserIdByAuthSubject, {
      authSubject,
    });
    if (!profile) {
      // The Better Auth `onCreate` trigger should have made this row inside the same
      // transaction that created the user. If it is missing, the wallet is the least of
      // it — say so here rather than failing silently three steps later.
      console.error(`[musea] no profile row for ${authSubject}; skipping wallet provisioning`);
      return null;
    }

    try {
      await ctx.runAction(internal.stellar.passkeyNode.provisionSmartAccount, {
        userId: profile.userId,
        userName: profile.name,
        registrationResponse,
      });
    } catch (error) {
      // Never rethrow: this runs detached from any request, so throwing only fills the
      // logs. The account exists and is signed in; the wallet card is the recovery path
      // and its retry is the one that gets exercised.
      console.error(
        `[musea] wallet provisioning failed for ${authSubject}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  },
});
