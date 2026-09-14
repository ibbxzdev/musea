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

// ── External (user-brought) wallets ──────────────────────────────────────────────────
//
// Freighter and friends. There is no secret in any of these rows, so unlike
// `getWalletByUser` above, the risk here is not key leakage — it is one user acting as
// another. Every helper is still `internal*`; the public surface is `./external.ts`,
// which derives the caller from `ctx.auth` and never takes a userId.

export const getExternalWalletByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const linkExternalWallet = internalMutation({
  args: { userId: v.id("users"), publicKey: v.string(), network: v.string() },
  handler: async (ctx, { userId, publicKey, network }) => {
    // One external wallet per user: re-linking replaces rather than accumulates, so
    // "which address am I tipping from" always has exactly one answer.
    const existing = await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { publicKey, network, linkedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("externalWallets", {
      userId,
      publicKey,
      network,
      linkedAt: Date.now(),
    });
  },
});

export const unlinkExternalWallet = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
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
