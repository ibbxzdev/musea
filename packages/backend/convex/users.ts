import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./model/auth";

/**
 * The signed-in user's profile and the things they can do to it.
 *
 * Note there is no `getUser({ userId })` here, on purpose. A public query that returns a
 * user by a client-supplied id is how profile data leaks; other curators are exposed only
 * through the narrow `owner` projection in convex/galleries.ts, which carries name, handle
 * and picture and nothing else.
 *
 * **There is no `deleteAccount` either, and its absence is deliberate.** It was removed at
 * the project owner's direction along with the profile UI that called it. Nothing else
 * reaches `auth.api.deleteUser`, so `deleteUser` is disabled in convex/auth.ts too — a
 * public mutation that erases an account, an entire library and a wallet row is not
 * something to leave reachable with no way to invoke it and no reason to.
 */

export const viewer = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      handle: v.string(),
      imageUrl: v.optional(v.string()),
      bio: v.optional(v.string()),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      handle: user.handle,
      imageUrl: user.imageUrl,
      bio: user.bio,
      createdAt: user.createdAt,
    };
  },
});

/**
 * The two counts on the profile page.
 *
 * Counted rather than kept as a running total: a denormalised counter that can be wrong
 * is worse than a read that costs a little, and neither galleries nor artifacts grow to a
 * size where this matters for one user. If a library ever does, `@convex-dev/counter` is
 * the upgrade, not a hand-rolled field.
 *
 * A distinct-tag count used to be a third tile. It was dropped from the profile, and it is
 * dropped here too rather than left computed and unread — the `returns` validator is a
 * contract, and a field nothing consumes is one a future reader has to go and check.
 */
export const stats = query({
  args: {},
  returns: v.object({ saves: v.number(), galleries: v.number() }),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    const [artifacts, galleries] = await Promise.all([
      ctx.db
        .query("artifacts")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(1000),
      ctx.db
        .query("galleries")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .take(100),
    ]);

    return {
      saves: artifacts.length,
      galleries: galleries.length,
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, { name, bio, imageStorageId }) => {
    const user = await requireCurrentUser(ctx);

    // An avatar is small and rendered on every screen, so the URL is resolved once here
    // rather than per read. It is the one place a storage URL is persisted, and the
    // trade is deliberate: Convex storage URLs for an avatar outlive a session.
    const imageUrl = imageStorageId
      ? ((await ctx.storage.getUrl(imageStorageId)) ?? user.imageUrl)
      : user.imageUrl;

    await ctx.db.patch(user._id, {
      name: name?.trim() || user.name,
      bio: bio === undefined ? user.bio : bio.trim() || undefined,
      imageUrl,
    });
    return null;
  },
});
