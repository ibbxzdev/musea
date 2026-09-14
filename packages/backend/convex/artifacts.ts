import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import {
  artifactOriginValidator,
  artifactViewValidator,
  resolveKind,
  resolveSourceType,
  searchTextFor,
  toView,
  toViews,
} from "./model/artifacts";
import { deleteUpload, requireUploadOwner } from "./files";
import { requireCurrentUser } from "./model/auth";
import { artifactKindValidator } from "./schema";

/**
 * Artifacts — the things a curator keeps.
 *
 * Ported from the phone app's `convex/artifacts.ts`, with two deliberate differences:
 *
 *   - **No `userId` argument anywhere.** The phone repo's `search.searchArtifacts` and
 *     `files.saveFile` both take one; that is an impersonation hole and CLAUDE.md's rule 2
 *     forbids it. The caller is whoever `ctx.auth` says they are, resolved through
 *     `requireCurrentUser`.
 *   - **No AI.** Saving a URL schedules `linkPreview.enrichArtifact`, which reads oEmbed
 *     and Open Graph and nothing else. Nothing writes a title, a summary or tags on the
 *     user's behalf beyond what the page itself published.
 */

/** The shape `.paginate()` returns, spelled out because Convex exports no helper for it. */
const paginatedArtifactsValidator = v.object({
  page: v.array(artifactViewValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

/** Search returns fewer than this even on a broad query; the grid is not a firehose. */
const SEARCH_LIMIT = 60;

export const create = mutation({
  args: {
    /** The URL being kept, when the save started from a link. */
    sourceUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    /** An upload's storage id, from `files.generateUploadUrl`. */
    imageStorageId: v.optional(v.id("_storage")),
    /** width / height, measured in the browser at pick time. Prevents grid reflow. */
    aspectRatio: v.optional(v.number()),
    /** Where a save with no URL came from: the photo library, Files, or the keyboard. */
    origin: v.optional(artifactOriginValidator),
    /** File it straight into galleries, so the save and the filing are one transaction. */
    galleryIds: v.optional(v.array(v.id("galleries"))),
  },
  returns: v.id("artifacts"),
  handler: async (ctx, args): Promise<Id<"artifacts">> => {
    const user = await requireCurrentUser(ctx);

    /**
     * Being signed in says nothing about whose file this is. Convex storage has no owner,
     * so the id is only trustworthy because `files.claimUpload` recorded who uploaded it —
     * without this check, a caller who learned another user's storage id could attach it
     * here and then destroy it by deleting the artifact.
     */
    if (args.imageStorageId) {
      await requireUploadOwner(ctx, user._id, args.imageStorageId);
    }

    const sourceUrl = args.sourceUrl?.trim() || undefined;
    const sourceType = resolveSourceType(sourceUrl, args.origin);
    const description = args.description?.trim() || undefined;
    const kind = resolveKind({
      sourceUrl,
      sourceType,
      hasUpload: Boolean(args.imageStorageId),
      hasText: Boolean(description),
    });

    const title = args.title?.trim() || sourceUrl || description?.slice(0, 80) || "Untitled";

    /**
     * A link starts `pending` because a scrape is on its way that will rewrite its title
     * and give it a thumbnail. Anything else is already everything it is going to be, so
     * calling it pending would be a spinner that never resolves.
     */
    const status = sourceUrl ? ("pending" as const) : ("ready" as const);

    const createdAt = Date.now();
    const artifactId = await ctx.db.insert("artifacts", {
      userId: user._id,
      kind,
      title,
      description,
      imageStorageId: args.imageStorageId,
      aspectRatio: args.aspectRatio,
      source: sourceUrl,
      sourceType,
      tags: [],
      status,
      searchText: searchTextFor({ title, description }),
      createdAt,
    });

    if (args.galleryIds?.length) {
      await fileIntoGalleries(ctx, {
        artifactId,
        galleryIds: args.galleryIds,
        userId: user._id,
        createdAt,
      });
    }

    if (sourceUrl) {
      await ctx.scheduler.runAfter(0, internal.linkPreview.enrichArtifact, { artifactId });
    }

    return artifactId;
  },
});

export const get = query({
  args: { artifactId: v.id("artifacts") },
  returns: v.union(artifactViewValidator, v.null()),
  handler: async (ctx, { artifactId }) => {
    const doc = await ownedArtifact(ctx, artifactId);
    return doc ? await toView(ctx, doc) : null;
  },
});

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    /** One filter chip. Omit for "All". */
    kind: v.optional(artifactKindValidator),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: paginatedArtifactsValidator,
  handler: async (ctx, { paginationOpts, kind, sortDir }) => {
    const user = await requireCurrentUser(ctx);
    const order = sortDir ?? "desc";

    /**
     * Two indexes, no `.filter()`. The phone repo filters on `image` / `videoUrl` /
     * `sourceType` inside the query, which reads rows only to throw them away. `kind` is
     * stored here, so a filter chip is an index range and the read is exactly the page.
     */
    const rows = kind
      ? await ctx.db
          .query("artifacts")
          .withIndex("by_user_kind", (q) => q.eq("userId", user._id).eq("kind", kind))
          .order(order)
          .paginate(paginationOpts)
      : await ctx.db
          .query("artifacts")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .order(order)
          .paginate(paginationOpts);

    return { ...rows, page: await toViews(ctx, rows.page) };
  },
});

/**
 * Full-text search over the caller's own library.
 *
 * The phone app does this with an OpenAI embedding and a vector index. There is no AI
 * here, so it is Convex's full-text index over the denormalised `searchText` field, which
 * covers the same three fields the vector search did (title, summary, tags) — minus the
 * ability to match on meaning rather than words.
 */
export const search = query({
  args: {
    query: v.string(),
    kind: v.optional(artifactKindValidator),
  },
  returns: v.array(artifactViewValidator),
  handler: async (ctx, { query: searchQuery, kind }) => {
    const user = await requireCurrentUser(ctx);

    const trimmed = searchQuery.trim();
    if (!trimmed) return [];

    const docs = await ctx.db
      .query("artifacts")
      .withSearchIndex("by_searchText", (q) => {
        const scoped = q.search("searchText", trimmed.toLowerCase()).eq("userId", user._id);
        return kind ? scoped.eq("kind", kind) : scoped;
      })
      .take(SEARCH_LIMIT);

    return await toViews(ctx, docs);
  },
});

/** "Have I kept this already?" — an index read, not a scan of the whole library. */
export const findBySource = query({
  args: { sourceUrl: v.string() },
  returns: v.union(artifactViewValidator, v.null()),
  handler: async (ctx, { sourceUrl }) => {
    const user = await requireCurrentUser(ctx);
    const doc = await ctx.db
      .query("artifacts")
      .withIndex("by_user_source", (q) => q.eq("userId", user._id).eq("source", sourceUrl))
      .first();
    return doc ? await toView(ctx, doc) : null;
  },
});

export const update = mutation({
  args: {
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { artifactId, title, description, tags }) => {
    const doc = await requireOwnedArtifact(ctx, artifactId);

    const next = {
      title: title?.trim() || doc.title,
      description: description === undefined ? doc.description : description.trim() || undefined,
      tags: tags ?? doc.tags,
    };

    await ctx.db.patch(artifactId, {
      ...next,
      // Rebuilt here rather than left stale: search would otherwise go on matching the
      // old title for as long as the row lives.
      searchText: searchTextFor(next),
    });
    return null;
  },
});

export const remove = mutation({
  args: { artifactId: v.id("artifacts") },
  returns: v.null(),
  handler: async (ctx, { artifactId }) => {
    const doc = await requireOwnedArtifact(ctx, artifactId);

    // Cascade the link rows. The galleries themselves stay — deleting one save must never
    // take a gallery with it.
    const links = await ctx.db
      .query("galleryArtifacts")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .collect();
    await Promise.all(links.map((link) => ctx.db.delete(link._id)));

    if (doc.imageStorageId) await deleteUpload(ctx, doc.imageStorageId);
    await ctx.db.delete(artifactId);
    return null;
  },
});

// ------------------------------------------------------------------ internal

/**
 * Read for the enrichment action.
 *
 * `v.any()` rather than the doc validator: this returns the raw row, internals included,
 * and only ever to another server function. It is an `internalQuery`, so it is not
 * client-reachable at all.
 */
export const getInternal = internalQuery({
  args: { artifactId: v.id("artifacts") },
  returns: v.any(),
  handler: async (ctx, { artifactId }) => await ctx.db.get(artifactId),
});

/**
 * The write half of enrichment.
 *
 * Deliberately narrow: it can set the fields a scrape produces, and nothing else. The
 * phone repo's equivalent takes a `partial(schema)` patch, which would let a future
 * caller move an artifact to a different user.
 */
export const applyEnrichment = internalMutation({
  args: {
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    authorImage: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, { artifactId, status, ...scraped }) => {
    const doc = await ctx.db.get(artifactId);
    if (!doc) return null;

    const title = scraped.title?.trim() || doc.title;
    const description = scraped.description?.trim() || doc.description;

    await ctx.db.patch(artifactId, {
      title,
      description,
      imageUrl: scraped.imageUrl ?? doc.imageUrl,
      videoUrl: scraped.videoUrl ?? doc.videoUrl,
      authorName: scraped.authorName ?? doc.authorName,
      authorHandle: scraped.authorHandle ?? doc.authorHandle,
      authorUrl: scraped.authorUrl ?? doc.authorUrl,
      authorImage: scraped.authorImage ?? doc.authorImage,
      // A scrape that turned up a playable video promotes a link card to a video card.
      kind: scraped.videoUrl && doc.kind === "link" ? "video" : doc.kind,
      status,
      searchText: searchTextFor({ title, description, tags: doc.tags }),
    });
    return null;
  },
});

// ------------------------------------------------------------------- helpers

/** The artifact if the caller owns it, else null. Reactive reads go through this. */
async function ownedArtifact(
  ctx: QueryCtx,
  artifactId: Id<"artifacts">,
): Promise<Doc<"artifacts"> | null> {
  const user = await requireCurrentUser(ctx);
  const doc = await ctx.db.get(artifactId);
  // Deliberately indistinguishable: a row you cannot see and a row that is not there have
  // to answer the same, or this query becomes "does id X exist?" for anyone who asks.
  if (!doc || doc.userId !== user._id) return null;
  return doc;
}

async function requireOwnedArtifact(
  ctx: QueryCtx,
  artifactId: Id<"artifacts">,
): Promise<Doc<"artifacts">> {
  const doc = await ownedArtifact(ctx, artifactId);
  if (!doc) throw new Error("Not found.");
  return doc;
}

/**
 * Link an artifact into galleries, skipping any the caller does not own.
 *
 * Shared with galleryArtifacts.ts. It re-checks ownership of every gallery id it is
 * handed, because the ids come from the client and "the caller owns the artifact" says
 * nothing about whether they own the gallery they are filing it into.
 */
export async function fileIntoGalleries(
  ctx: MutationCtx,
  {
    artifactId,
    galleryIds,
    userId,
    createdAt,
  }: {
    artifactId: Id<"artifacts">;
    galleryIds: Id<"galleries">[];
    userId: Id<"users">;
    createdAt: number;
  },
): Promise<number> {
  // One read for every gallery this artifact is already in, rather than one per candidate.
  // An artifact belongs to a handful of galleries, so this set is small by construction.
  const existing = new Set(
    (
      await ctx.db
        .query("galleryArtifacts")
        .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
        .collect()
    ).map((link) => link.galleryId),
  );

  let filed = 0;
  for (const galleryId of galleryIds) {
    if (existing.has(galleryId)) continue;

    const gallery = await ctx.db.get(galleryId);
    if (!gallery || gallery.ownerId !== userId) continue;

    await ctx.db.insert("galleryArtifacts", { galleryId, artifactId, userId, createdAt });
    existing.add(galleryId);
    filed++;
  }
  return filed;
}
