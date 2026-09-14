import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { fileIntoGalleries } from "./artifacts";
import { ownedGallery } from "./galleries";
import { artifactViewValidator, toViews } from "./model/artifacts";
import { getCurrentUser, requireCurrentUser } from "./model/auth";

/**
 * Filing — the artifact ↔ gallery join.
 *
 * Ported from the phone app's `convex/galleryArtifacts.ts`. Every entry point resolves the
 * caller from `ctx.auth` and re-checks ownership of *both* ends: owning an artifact says
 * nothing about owning the gallery it is being filed into, and vice versa. The phone repo
 * is careful about this too; it is repeated here because it is the one thing in this file
 * that is easy to get wrong and impossible to notice.
 */

const paginatedArtifactsValidator = v.object({
  page: v.array(artifactViewValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

/**
 * Everything filed in a gallery.
 *
 * Readable without a session when the gallery is public — this is what the Community page
 * renders. A gallery you may not see resolves to an empty page rather than throwing, so
 * the subscription settles cleanly the moment one is deleted out from under a screen.
 */
export const listArtifacts = query({
  args: { galleryId: v.id("galleries"), paginationOpts: paginationOptsValidator },
  returns: paginatedArtifactsValidator,
  handler: async (ctx, { galleryId, paginationOpts }) => {
    const [gallery, viewer] = await Promise.all([ctx.db.get(galleryId), getCurrentUser(ctx)]);
    const visible = gallery && (gallery.isPublic || viewer?._id === gallery.ownerId);
    if (!visible) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
      .order("desc")
      .paginate(paginationOpts);

    const docs = (await Promise.all(links.page.map((link) => ctx.db.get(link.artifactId)))).filter(
      (doc): doc is Doc<"artifacts"> => doc !== null,
    );

    return { ...links, page: await toViews(ctx, docs) };
  },
});

/** Which of the caller's galleries an artifact is filed in. Drives the "In your galleries" list. */
export const listGalleriesForArtifact = query({
  args: { artifactId: v.id("artifacts") },
  returns: v.array(
    v.object({
      _id: v.id("galleries"),
      title: v.string(),
      isPublic: v.boolean(),
    }),
  ),
  handler: async (ctx, { artifactId }) => {
    const user = await requireCurrentUser(ctx);

    const artifact = await ctx.db.get(artifactId);
    if (!artifact || artifact.userId !== user._id) return [];

    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .collect();

    const galleries = await Promise.all(links.map((link) => ctx.db.get(link.galleryId)));

    return galleries
      .filter((gallery): gallery is Doc<"galleries"> => gallery !== null)
      .map((gallery) => ({
        _id: gallery._id,
        title: gallery.title,
        isPublic: gallery.isPublic ?? false,
      }));
  },
});

export const addToGallery = mutation({
  args: { galleryId: v.id("galleries"), artifactIds: v.array(v.id("artifacts")) },
  returns: v.number(),
  handler: async (ctx, { galleryId, artifactIds }) => {
    const user = await requireCurrentUser(ctx);

    const gallery = await ownedGallery(ctx, galleryId);
    if (!gallery) throw new Error("Not found.");

    const createdAt = Date.now();
    let filed = 0;

    for (const artifactId of artifactIds) {
      const artifact = await ctx.db.get(artifactId);
      // You can only file your own saves, even into your own gallery.
      if (!artifact || artifact.userId !== user._id) continue;

      filed += await fileIntoGalleries(ctx, {
        artifactId,
        galleryIds: [galleryId],
        userId: user._id,
        createdAt,
      });
    }

    return filed;
  },
});

export const removeFromGallery = mutation({
  args: { galleryId: v.id("galleries"), artifactIds: v.array(v.id("artifacts")) },
  returns: v.null(),
  handler: async (ctx, { galleryId, artifactIds }) => {
    const gallery = await ownedGallery(ctx, galleryId);
    if (!gallery) throw new Error("Not found.");

    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
      .collect();

    const wanted = new Set<string>(artifactIds);
    await Promise.all(
      links.filter((link) => wanted.has(link.artifactId)).map((link) => ctx.db.delete(link._id)),
    );
    return null;
  },
});

/**
 * Set the complete list of galleries one artifact is filed in.
 *
 * The checkbox sheet's save button. One mutation rather than an add-each plus a
 * remove-each, so a half-applied change cannot survive a dropped connection.
 */
export const setGalleriesForArtifact = mutation({
  args: { artifactId: v.id("artifacts"), galleryIds: v.array(v.id("galleries")) },
  returns: v.object({ added: v.number(), removed: v.number() }),
  handler: async (ctx, { artifactId, galleryIds }) => {
    const user = await requireCurrentUser(ctx);

    const artifact = await ctx.db.get(artifactId);
    if (!artifact || artifact.userId !== user._id) throw new Error("Not found.");

    const existing = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .collect();

    const wanted = new Set<string>(galleryIds);
    const toRemove = existing.filter((link) => !wanted.has(link.galleryId));
    await Promise.all(toRemove.map((link) => ctx.db.delete(link._id)));

    // fileIntoGalleries checks ownership of each gallery id and skips duplicates, so a
    // gallery id belonging to someone else is silently dropped rather than filed.
    const added = await fileIntoGalleries(ctx, {
      artifactId,
      galleryIds,
      userId: user._id,
      createdAt: Date.now(),
    });

    return { added, removed: toRemove.length };
  },
});
