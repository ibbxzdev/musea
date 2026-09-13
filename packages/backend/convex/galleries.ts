import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./model/auth";

/**
 * Galleries — the standalone stand-in for Musea's real gallery model.
 *
 * Reads here are public on purpose: a signed-out visitor can browse galleries and see
 * their on-chain tip totals. Only tipping requires a session.
 */

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    const galleries = await ctx.db
      .query("galleries")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(limit, 100));

    return await Promise.all(
      galleries.map(async (gallery) => ({
        ...gallery,
        owner: await publicOwner(ctx, gallery.ownerId),
      })),
    );
  },
});

export const get = query({
  args: { galleryId: v.id("galleries") },
  handler: async (ctx, { galleryId }) => {
    const gallery = await ctx.db.get(galleryId);
    if (!gallery) return null;

    const [owner, items, viewer] = await Promise.all([
      publicOwner(ctx, gallery.ownerId),
      ctx.db
        .query("galleryItems")
        .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
        .collect(),
      getCurrentUser(ctx),
    ]);

    return {
      ...gallery,
      owner,
      items,
      /** Drives whether the Tip button renders — the contract rejects self-tips anyway. */
      isOwnGallery: viewer?._id === gallery.ownerId,
    };
  },
});

/**
 * Only ever expose a curator's public-facing fields.
 *
 * Spreading the whole user doc here would leak `authSubject` to every visitor, which is
 * the kind of thing that is invisible until it isn't.
 */
async function publicOwner(ctx: QueryCtx, ownerId: Id<"users">) {
  const owner = await ctx.db.get(ownerId);
  if (!owner) return null;
  return { _id: owner._id, name: owner.name, handle: owner.handle, imageUrl: owner.imageUrl };
}
