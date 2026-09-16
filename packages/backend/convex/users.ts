import { v } from "convex/values";
import { authComponent, createAuth } from "./auth";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./model/auth";

/**
 * The signed-in user's profile and the things they can do to it.
 *
 * Note there is no `getUser({ userId })` here, on purpose. A public query that returns a
 * user by a client-supplied id is how profile data leaks; other curators are exposed only
 * through the narrow `owner` projection in convex/galleries.ts, which carries name, handle
 * and picture and nothing else.
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
 * The three counts on the profile page.
 *
 * Counted rather than kept as a running total: a denormalised counter that can be wrong
 * is worse than a read that costs a little, and neither galleries nor artifacts grow to a
 * size where this matters for one user. If a library ever does, `@convex-dev/counter` is
 * the upgrade, not a hand-rolled field.
 */
export const stats = query({
  args: {},
  returns: v.object({ saves: v.number(), galleries: v.number(), tags: v.number() }),
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
      tags: new Set(artifacts.flatMap((artifact) => artifact.tags)).size,
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

/**
 * Delete everything this account kept, then the account.
 *
 * What it removes: artifacts (and their uploads), gallery filings, galleries.
 *
 * What it deliberately does not touch: `tips`. A tip row is also the *other* party's
 * receipt, and the transaction it records is on a public ledger that cannot be unsent —
 * deleting our copy would not undo anything, it would only make our side disagree with
 * the chain. The rows keep pointing at an id that no longer resolves, and the activity
 * view renders that as a departed curator.
 *
 * The passkey and smart-account rows go too — see the notes at each. Both delete only our
 * *record*: the credential stays in the device keychain and the contract stays deployed
 * on-chain, because neither is ours to destroy. That is the sweep-or-abandon question
 * answered narrowly rather than turned into a custody policy in this file.
 */
export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    await Promise.all(links.map((link) => ctx.db.delete(link._id)));

    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    await Promise.all(artifacts.map((artifact) => ctx.db.delete(artifact._id)));

    const galleries = await ctx.db
      .query("galleries")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    await Promise.all(galleries.map((gallery) => ctx.db.delete(gallery._id)));

    /**
     * Uploads by the `files` index rather than by walking the artifacts above: an upload
     * that was claimed and then never attached to anything (the sheet was closed
     * mid-save) has no artifact pointing at it, and leaving those behind would mean a
     * deleted account still had files in storage.
     */
    const uploads = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    await Promise.all(
      uploads.map(async (file) => {
        await ctx.storage.delete(file.storageId);
        await ctx.db.delete(file._id);
      }),
    );

    /**
     * The passkey credentials this account signs in with.
     *
     * These have to go, and for a sharper reason than tidiness: a credential id is
     * write-once in `passkeys.recordCredential`, so a row left behind would permanently
     * block that same device from ever registering again — the user would delete their
     * account and then be unable to make a new one on the phone they are holding.
     *
     * Only our record is deleted. The passkey itself stays in the device's keychain and is
     * not ours to remove; the user clears it in iOS Settings if they want to.
     */
    const credentials = await ctx.db
      .query("passkeyCredentials")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    await Promise.all(credentials.map((credential) => ctx.db.delete(credential._id)));

    /**
     * The smart account row, for the same reason and with the same limit: the contract
     * stays deployed on-chain holding whatever balance it holds, because a testnet
     * contract is not ours to destroy and the passkey that controls it still exists.
     * Registering again on the same device derives the same address, so nothing is
     * stranded — see `stellar/internal.ts:deleteSmartAccount`.
     */
    const wallet = await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (wallet) await ctx.db.delete(wallet._id);

    /**
     * The Better Auth user last. Its `onDelete` trigger (convex/auth.ts) deletes our
     * `users` row, so doing this first would pull the identity out from under the reads
     * above mid-transaction.
     */
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    await auth.api.deleteUser({ body: {}, headers });
    return null;
  },
});
