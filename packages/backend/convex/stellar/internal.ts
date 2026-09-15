import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Database helpers for the Stellar layer.
 *
 * These run in the DEFAULT Convex runtime (no "use node") — they touch only the database.
 * Actions cannot write to the database, so every persistence step in wallets.ts/tips.ts
 * goes through one of these.
 *
 * Everything here is `internal*`: none of it is reachable from the client. The public,
 * auth-guarded surfaces are `./tips.ts` and `./external.ts`.
 */

export const getGallery = internalQuery({
  args: { galleryId: v.id("galleries") },
  handler: async (ctx, { galleryId }) => {
    return await ctx.db.get(galleryId);
  },
});

/**
 * How long an in-flight tip blocks another to the same gallery from the same user.
 *
 * Comfortably longer than the ~30s confirmation ceiling, so a tip still being polled
 * always blocks its own double-submit, and short enough that a genuine second tip a minute
 * later is not refused.
 */
const PENDING_TIP_WINDOW_MS = 60_000;

/** Thrown by the guard below; `classifyStellarError` maps it to DUPLICATE_TIP. */
export const DUPLICATE_PENDING_TIP = "DUPLICATE_PENDING_TIP";

export const recordTipPending = internalMutation({
  args: {
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    galleryId: v.id("galleries"),
    fromPublicKey: v.string(),
    toPublicKey: v.string(),
    galleryHashHex: v.string(),
    amountStroops: v.string(),
    /** Externally-signed tips only; see the schema comment on `tips.preparedTxHash`. */
    preparedTxHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Double-submit guard, deliberately inside the mutation that inserts rather than as a
    // separate query the action runs first. Convex mutations are serializable
    // transactions, so checking and inserting here cannot interleave; a check-then-insert
    // pair across two calls has a real race window on precisely the operation where
    // losing it spends the user's money twice.
    //
    // The UI guards this too (Epic 3 disables the button in flight). This is the half that
    // still holds when a phone retries a dropped request, or the action is replayed.
    const recent = await ctx.db
      .query("tips")
      .withIndex("by_from", (q) =>
        q.eq("fromUserId", args.fromUserId).gt("createdAt", Date.now() - PENDING_TIP_WINDOW_MS),
      )
      .collect();

    const inFlight = recent.some(
      (tip) => tip.status === "pending" && tip.galleryId === args.galleryId,
    );
    if (inFlight) throw new Error(DUPLICATE_PENDING_TIP);

    return await ctx.db.insert("tips", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const markTipSuccess = internalMutation({
  args: { tipId: v.id("tips"), txHash: v.string() },
  handler: async (ctx, { tipId, txHash }) => {
    await ctx.db.patch(tipId, { status: "success", txHash, confirmedAt: Date.now() });
  },
});

export const markTipFailed = internalMutation({
  args: {
    tipId: v.id("tips"),
    errorCode: v.string(),
    /** Server-side only. Scrub anything key-shaped before passing it here. */
    errorDetail: v.optional(v.string()),
  },
  handler: async (ctx, { tipId, errorCode, errorDetail }) => {
    await ctx.db.patch(tipId, { status: "failed", errorCode, errorDetail });
  },
});

// ── Passkey smart accounts ───────────────────────────────────────────────────────────
//
// There is no secret in any of these rows and there never can be — the signing key lives
// in the device's Secure Enclave and is not extractable. So the risk guarded against here
// is not key leakage but one user acting as another. Every helper is `internal*`; the
// public surface is `./passkey.ts`, which derives the caller from `ctx.auth` and never
// takes a userId.

export const getSmartAccountByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * Create the account row, or return the existing one.
 *
 * **Never replaces a deployed account.** Provisioning is retried, and a retry that minted
 * a second account would strand whatever the first one held — with no way back, since the
 * credential that signs for it is bound to the device. A user gets one smart account; if a
 * row already exists, that is the answer.
 */
export const upsertSmartAccount = internalMutation({
  args: {
    userId: v.id("users"),
    contractAddress: v.string(),
    credentialId: v.string(),
    publicKeyHex: v.string(),
    rpId: v.string(),
    status: v.union(v.literal("pending"), v.literal("deployed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      if (existing.status === "deployed") return existing._id;
      // A pending or failed row is a provisioning attempt that did not finish. Re-point it
      // at this attempt's credential rather than accumulating dead rows.
      await ctx.db.patch(existing._id, {
        contractAddress: args.contractAddress,
        credentialId: args.credentialId,
        publicKeyHex: args.publicKeyHex,
        rpId: args.rpId,
        status: args.status,
        deploymentError: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("smartAccounts", {
      ...args,
      funded: false,
      createdAt: Date.now(),
    });
  },
});

export const markSmartAccountDeployed = internalMutation({
  args: {
    accountId: v.id("smartAccounts"),
    birthWasmHash: v.string(),
    creationTransactionHash: v.string(),
    creationLedger: v.number(),
  },
  handler: async (ctx, { accountId, ...birth }) => {
    await ctx.db.patch(accountId, { ...birth, status: "deployed", deploymentError: undefined });
  },
});

export const markSmartAccountFunded = internalMutation({
  args: { accountId: v.id("smartAccounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { funded: true });
  },
});

export const markSmartAccountFailed = internalMutation({
  args: { userId: v.id("users"), deploymentError: v.string() },
  handler: async (ctx, { userId, deploymentError }) => {
    const existing = await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // A deployment that already succeeded must not be demoted by a later failure in, say,
    // the funding step — the account exists on-chain regardless of what happened after.
    if (!existing || existing.status === "deployed") return;
    await ctx.db.patch(existing._id, { status: "failed", deploymentError });
  },
});

/** Hold the in-flight passkey state while the browser signs. See the schema comment. */
export const attachPreparedTip = internalMutation({
  args: {
    tipId: v.id("tips"),
    preparedXdr: v.string(),
    signatureExpirationLedger: v.number(),
    authChallenge: v.string(),
  },
  handler: async (ctx, { tipId, ...prepared }) => {
    await ctx.db.patch(tipId, prepared);
  },
});

/**
 * Load a pending tip for submission, proving it belongs to the caller.
 *
 * The two-step external flow hands a `tipId` to the browser and takes it back, which makes
 * it a client-supplied id — exactly the shape CLAUDE.md rule 2 is about. Without this
 * ownership check, one user could drive another user's pending tip to a terminal state.
 * Returning `null` rather than throwing lets the caller decide the error code.
 */
export const getOwnedPendingTip = internalQuery({
  args: { tipId: v.id("tips"), userId: v.id("users") },
  handler: async (ctx, { tipId, userId }) => {
    const tip = await ctx.db.get(tipId);
    if (!tip) return null;
    if (tip.fromUserId !== userId) return null;
    if (tip.status !== "pending") return null;
    return tip;
  },
});

/**
 * Link a wallet to the Musea profile behind a Better Auth subject.
 *
 * The wallet sign-in plugin (convex/model/walletAuth.ts) knows the Better Auth user id,
 * because that is what it just created a session for. It does not know the `users._id`,
 * and it must not take one from the client. This resolves the one from the other.
 *
 * Why link at all: a curator who signed in *with* a wallet has, by construction, proved
 * they hold its key. Making them press "Connect wallet" afterwards to become tippable
 * would be asking for the same proof twice. Signing in is the connection.
 *
 * Returns false when no profile row exists yet rather than throwing. The session is
 * already created by the time this runs, so a failure here must not read as a failed
 * sign-in — the user is signed in, just not yet tippable, and the connect-wallet flow in
 * the app is the recovery path.
 */
export const linkExternalWalletByAuthSubject = internalMutation({
  args: { authSubject: v.string(), publicKey: v.string(), network: v.string() },
  handler: async (ctx, { authSubject, publicKey, network }): Promise<boolean> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", authSubject))
      .unique();
    if (!user) return false;

    const existing = await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        publicKey,
        network: network.toUpperCase(),
        linkedAt: Date.now(),
      });
      return true;
    }

    await ctx.db.insert("externalWallets", {
      userId: user._id,
      publicKey,
      network: network.toUpperCase(),
      linkedAt: Date.now(),
    });
    return true;
  },
});
