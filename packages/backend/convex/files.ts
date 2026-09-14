import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCurrentUser } from "./model/auth";

/**
 * Uploads.
 *
 * The phone app's `files.saveFile` takes a `userId` argument and writes it to the row.
 * That is CLAUDE.md's rule 2 exactly, so it is not ported: the owner comes from
 * `ctx.auth`.
 *
 * Nothing stores a storage *URL*. Convex storage URLs are resolved per read
 * (`convex/model/artifacts.ts`), because a persisted one goes stale.
 */

/**
 * A one-shot, short-lived URL the browser POSTs the file to.
 *
 * Signed-in only. An anonymous caller who can mint these can fill the deployment's
 * storage quota with whatever they like.
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Record who uploaded a file, immediately after the POST that created it.
 *
 * This is the step that makes an `Id<"_storage">` mean something. Convex storage tracks
 * no owner, so without this every mutation taking a storage id would have to trust the
 * caller that they uploaded it.
 *
 * Write-once on purpose: a storage id that already has an owner is refused rather than
 * re-assigned, so claiming cannot be used to take a file over. The refusal is the same
 * vague "Not found." every other ownership failure gives, so it does not double as an
 * oracle for which storage ids exist.
 */
export const claimUpload = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const user = await requireCurrentUser(ctx);

    const existing = await ctx.db
      .query("files")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (existing) throw new Error("Not found.");

    await ctx.db.insert("files", { storageId, userId: user._id, createdAt: Date.now() });
    return null;
  },
});

/** Throws unless `userId` is the recorded uploader of `storageId`. */
export async function requireUploadOwner(
  ctx: QueryCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<void> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  if (!file || file.userId !== userId) throw new Error("Not found.");
}

/**
 * Delete a stored file and forget it, if the caller uploaded it.
 *
 * Used by the cascades in artifacts.ts and users.ts. Silent when the row is missing —
 * these run while tearing other things down, and a half-finished delete is worse than a
 * leftover file.
 */
export async function deleteUpload(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  if (file) await ctx.db.delete(file._id);
  await ctx.storage.delete(storageId);
}
