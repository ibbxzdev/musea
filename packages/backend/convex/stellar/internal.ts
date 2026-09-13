import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Database helpers for the Stellar layer.
 *
 * These run in the DEFAULT Convex runtime (no "use node") — they touch only the database.
 * Actions cannot write to the database, so every persistence step in wallets.ts/tips.ts
 * goes through one of these.
 *
 * Everything here is `internal*`: none of it is reachable from the client. That matters
 * most for `getWalletByUser`, which returns the encrypted secret — it must never become a
 * public query, and its result must never be returned from an action to the browser.
 */

export const getWalletByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("stellarWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const storeWallet = internalMutation({
  args: {
    userId: v.id("users"),
    publicKey: v.string(),
    encryptedSecret: v.string(),
    funded: v.boolean(),
    trustlineReady: v.boolean(),
    seeded: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Guard against a double-provision race creating two wallets for one user.
    const existing = await ctx.db
      .query("stellarWallets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("stellarWallets", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const markWalletProgress = internalMutation({
  args: {
    userId: v.id("users"),
    funded: v.optional(v.boolean()),
    trustlineReady: v.optional(v.boolean()),
    seeded: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, ...progress }) => {
    const wallet = await ctx.db
      .query("stellarWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("No wallet to update.");
    await ctx.db.patch(wallet._id, progress);
  },
});

export const setCachedBalance = internalMutation({
  args: { userId: v.id("users"), balanceStroops: v.string() },
  handler: async (ctx, { userId, balanceStroops }) => {
    const wallet = await ctx.db
      .query("stellarWallets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) return;
    await ctx.db.patch(wallet._id, {
      cachedBalanceStroops: balanceStroops,
      balanceUpdatedAt: Date.now(),
    });
  },
});

export const getGallery = internalQuery({
  args: { galleryId: v.id("galleries") },
  handler: async (ctx, { galleryId }) => {
    return await ctx.db.get(galleryId);
  },
});

export const recordTipPending = internalMutation({
  args: {
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    galleryId: v.id("galleries"),
    fromPublicKey: v.string(),
    toPublicKey: v.string(),
    galleryHashHex: v.string(),
    amountStroops: v.string(),
  },
  handler: async (ctx, args) => {
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
