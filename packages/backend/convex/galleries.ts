import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { toViews } from "./model/artifacts";
import { getCurrentUser, requireCurrentUser } from "./model/auth";

/**
 * Galleries.
 *
 * Two audiences, and keeping them apart is the whole job of this file:
 *
 *   - **The owner**, through `listMine` / `create` / `update` / `remove`. These are the
 *     phone app's `convex/galleries.ts`, minus `promoteGallery` and `autoFileDisabled` —
 *     both of which only exist to manage the LLM auto-filer.
 *   - **Everyone else**, through `listPublic` / `get`. A gallery is visible to a stranger
 *     only when its owner set `isPublic`. This is what the Community page renders and
 *     what a tip is sent to; the tipping code reaches galleries through `Id<"galleries">`
 *     and these queries, never by reading the table itself.
 */

const ownerValidator = v.object({
  _id: v.id("users"),
  name: v.string(),
  handle: v.string(),
  imageUrl: v.optional(v.string()),
});

const galleryCardValidator = v.object({
  _id: v.id("galleries"),
  title: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  createdAt: v.number(),
  /** Up to three thumbnails for the cover mosaic, oldest filed first. */
  coverImageUrls: v.array(v.string()),
  saveCount: v.number(),
  owner: v.union(ownerValidator, v.null()),
});

/** Resolved thumbnails to fetch for a cover; a few may be notes with no picture. */
const COVER_SCAN = 12;

export const listMine = query({
  args: {},
  returns: v.array(galleryCardValidator),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const galleries = await ctx.db
      .query("galleries")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(100);

    return await Promise.all(galleries.map((gallery) => toCard(ctx, gallery)));
  },
});

/**
 * Public galleries from every curator — the Community page.
 *
 * Includes the caller's own public galleries rather than hiding them: a curator wants to
 * see their gallery the way a visitor does, and quietly filtering it out reads as a bug.
 */
export const listPublic = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(galleryCardValidator),
  handler: async (ctx, { limit = 50 }) => {
    const galleries = await ctx.db
      .query("galleries")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(Math.min(limit, 100));

    return await Promise.all(galleries.map((gallery) => toCard(ctx, gallery)));
  },
});

/**
 * One gallery and everything filed in it.
 *
 * Readable without a session when the gallery is public, so a visitor can browse and tip
 * before signing up. A private gallery answers `null` to everyone but its owner — the
 * same answer a deleted one gives, so this cannot be used to probe for ids.
 */
export const get = query({
  args: { galleryId: v.id("galleries") },
  returns: v.union(
    v.object({
      _id: v.id("galleries"),
      title: v.string(),
      description: v.optional(v.string()),
      isPublic: v.boolean(),
      createdAt: v.number(),
      owner: v.union(ownerValidator, v.null()),
      isOwn: v.boolean(),
      saveCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { galleryId }) => {
    const [gallery, viewer] = await Promise.all([ctx.db.get(galleryId), getCurrentUser(ctx)]);
    if (!gallery) return null;

    const isOwn = viewer?._id === gallery.ownerId;
    if (!gallery.isPublic && !isOwn) return null;

    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
      .take(1000);

    return {
      _id: gallery._id,
      title: gallery.title,
      description: gallery.description,
      isPublic: gallery.isPublic ?? false,
      createdAt: gallery.createdAt,
      owner: await publicOwner(ctx, gallery.ownerId),
      /** Drives whether the Tip button renders — the contract rejects self-tips anyway. */
      isOwn,
      saveCount: links.length,
    };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id("galleries"),
  handler: async (ctx, { title, description, isPublic }): Promise<Id<"galleries">> => {
    const user = await requireCurrentUser(ctx);

    const trimmed = title.trim();
    if (!trimmed) throw new Error("A gallery needs a name.");

    return await ctx.db.insert("galleries", {
      ownerId: user._id,
      title: trimmed,
      description: description?.trim() || undefined,
      isPublic: isPublic ?? false,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    galleryId: v.id("galleries"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { galleryId, title, description, isPublic }) => {
    const gallery = await requireOwnedGallery(ctx, galleryId);

    await ctx.db.patch(galleryId, {
      title: title?.trim() || gallery.title,
      description:
        description === undefined ? gallery.description : description.trim() || undefined,
      isPublic: isPublic ?? gallery.isPublic ?? false,
    });
    return null;
  },
});

export const remove = mutation({
  args: { galleryId: v.id("galleries") },
  returns: v.null(),
  handler: async (ctx, { galleryId }) => {
    await requireOwnedGallery(ctx, galleryId);

    // Cascade the link rows only. The artifacts stay in the library — deleting a gallery
    // is un-filing, not un-saving.
    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
      .collect();
    await Promise.all(links.map((link) => ctx.db.delete(link._id)));

    await ctx.db.delete(galleryId);
    return null;
  },
});

// ------------------------------------------------------------------- helpers

/**
 * The gallery if the caller owns it. Throws otherwise — including when it simply is not
 * there, so the error cannot be used to tell the two apart.
 */
export async function requireOwnedGallery(
  ctx: QueryCtx,
  galleryId: Id<"galleries">,
): Promise<Doc<"galleries">> {
  const user = await requireCurrentUser(ctx);
  const gallery = await ctx.db.get(galleryId);
  if (!gallery || gallery.ownerId !== user._id) throw new Error("Not found.");
  return gallery;
}

/** The gallery if the caller owns it, else null. For reads that must not throw. */
export async function ownedGallery(
  ctx: QueryCtx,
  galleryId: Id<"galleries">,
): Promise<Doc<"galleries"> | null> {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const gallery = await ctx.db.get(galleryId);
  if (!gallery || gallery.ownerId !== user._id) return null;
  return gallery;
}

/**
 * A card's worth of a gallery: the cover mosaic and the save count, without shipping a
 * single full artifact document per tile.
 */
async function toCard(ctx: QueryCtx, gallery: Doc<"galleries">) {
  const links = await ctx.db
    .query("galleryArtifacts")
    .withIndex("by_gallery", (q) => q.eq("galleryId", gallery._id))
    .order("asc") // oldest filed first, so a cover stops changing once it is set
    .take(1000);

  // Scan a window rather than the first three: a gallery whose oldest saves are notes
  // would otherwise show an empty cover.
  const resolved = await toViews(
    ctx,
    (
      await Promise.all(links.slice(0, COVER_SCAN).map((link) => ctx.db.get(link.artifactId)))
    ).filter((doc): doc is Doc<"artifacts"> => doc !== null),
  );

  const coverImageUrls = resolved
    .map((artifact) => artifact.imageUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);

  return {
    _id: gallery._id,
    title: gallery.title,
    description: gallery.description,
    isPublic: gallery.isPublic ?? false,
    createdAt: gallery.createdAt,
    coverImageUrls,
    saveCount: links.length,
    owner: await publicOwner(ctx, gallery.ownerId),
  };
}

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
