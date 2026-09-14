import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { type Infer, v } from "convex/values";
import { artifactKindValidator, artifactStatusValidator, sourceTypeValidator } from "../schema";

/**
 * Artifact derivations, in one place.
 *
 * Everything here is a pure function of what the caller saved, computed once at write
 * time. Nothing is re-derived at render: a card that decides what an artifact "is" from
 * whichever fields happen to be populated will quietly disagree with the filter chip that
 * put it on screen.
 */

export type SourceType = Infer<typeof sourceTypeValidator>;
export type ArtifactKind = Infer<typeof artifactKindValidator>;
export type ArtifactStatus = Infer<typeof artifactStatusValidator>;

const SOURCE_TYPE_BY_HOST: Record<string, SourceType> = {
  "pinterest.com": "pinterest",
  "pin.it": "pinterest",

  "x.com": "x",
  "twitter.com": "x",
  "t.co": "x",

  "youtube.com": "youtube",
  "youtu.be": "youtube",

  "reddit.com": "reddit",
  "redd.it": "reddit",

  "tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",

  "instagram.com": "instagram",
  "instagr.am": "instagram",
};

/**
 * Origins that cannot be inferred from a URL, because there is no URL: something picked
 * out of the photo library, something dragged in from Files, something typed.
 */
export const artifactOriginValidator = v.union(
  v.literal("gallery"),
  v.literal("files"),
  v.literal("note"),
);
export type ArtifactOrigin = Infer<typeof artifactOriginValidator>;

export function resolveSourceType(
  sourceUrl: string | undefined,
  origin: ArtifactOrigin | undefined,
): SourceType {
  if (origin) return origin;
  if (!sourceUrl) return "note";

  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
    if (SOURCE_TYPE_BY_HOST[hostname]) return SOURCE_TYPE_BY_HOST[hostname];
    // Instagram serves its media off a CDN whose host is not instagram.com.
    if (hostname === "cdninstagram.com" || hostname.endsWith(".cdninstagram.com")) {
      return "instagram";
    }
    return "link";
  } catch {
    return "link";
  }
}

const IMAGE_URL = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;

/** Sources whose posts are pictures, whatever else is on the page. */
const PICTURE_SOURCES = new Set<SourceType>(["pinterest", "instagram", "gallery", "files"]);

/** Sources that are videos, whatever else is on the page. */
const VIDEO_SOURCES = new Set<SourceType>(["youtube", "tiktok"]);

/**
 * What the card should render as.
 *
 * Each branch is a claim about the *source*, not about which fields happen to be filled
 * in yet: a YouTube URL is a video the moment it is pasted, before anything has been
 * scraped, and a Pinterest pin is a picture even though what we saved is a link to a
 * page. A bare URL we know nothing about is a link — enrichment may find a direct video
 * on it later and promote it.
 */
export function resolveKind({
  sourceUrl,
  sourceType,
  hasUpload,
  hasVideo,
  hasText,
}: {
  sourceUrl?: string;
  sourceType: SourceType;
  hasUpload?: boolean;
  hasVideo?: boolean;
  hasText?: boolean;
}): ArtifactKind {
  if (hasVideo || VIDEO_SOURCES.has(sourceType)) return "video";
  if (hasUpload || PICTURE_SOURCES.has(sourceType)) return "image";
  if (sourceUrl && IMAGE_URL.test(sourceUrl)) return "image";
  if (sourceUrl) return "link";
  if (hasText || sourceType === "note") return "note";
  return "link";
}

/**
 * The one writer of `searchText`.
 *
 * A Convex search index covers a single field; the app searches titles, summaries and
 * tags. Folding the three into one lowercased string at write time is how that is done —
 * see the note on the field in schema.ts.
 */
export function searchTextFor({
  title,
  description,
  tags,
}: {
  title: string;
  description?: string;
  tags?: string[];
}): string {
  return [title, description ?? "", ...(tags ?? [])].join(" ").toLowerCase().slice(0, 4000);
}

/**
 * What the client is allowed to see of an artifact.
 *
 * Two reasons this is a projection rather than the raw document:
 *
 *   1. `imageStorageId` is meaningless to a browser. The URL it resolves to is signed and
 *      expiring, so it is produced per read and never persisted.
 *   2. `searchText` and `userId` are internals. Shipping them costs bandwidth on every
 *      tile in a grid and tells a reader things the UI never renders.
 */
export type ArtifactView = {
  _id: Id<"artifacts">;
  kind: ArtifactKind;
  title: string;
  description?: string;
  imageUrl?: string;
  aspectRatio?: number;
  videoUrl?: string;
  source?: string;
  sourceType: SourceType;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  tags: string[];
  status: ArtifactStatus;
  createdAt: number;
};

export const artifactViewValidator = v.object({
  _id: v.id("artifacts"),
  kind: artifactKindValidator,
  title: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  aspectRatio: v.optional(v.number()),
  videoUrl: v.optional(v.string()),
  source: v.optional(v.string()),
  sourceType: sourceTypeValidator,
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  authorUrl: v.optional(v.string()),
  tags: v.array(v.string()),
  status: artifactStatusValidator,
  createdAt: v.number(),
});

export async function toView(ctx: QueryCtx, doc: Doc<"artifacts">): Promise<ArtifactView> {
  // An upload wins over a scraped thumbnail: it is the thing the user actually chose.
  const imageUrl = doc.imageStorageId
    ? ((await ctx.storage.getUrl(doc.imageStorageId)) ?? doc.imageUrl)
    : doc.imageUrl;

  return {
    _id: doc._id,
    kind: doc.kind,
    title: doc.title,
    description: doc.description,
    imageUrl: imageUrl ?? undefined,
    aspectRatio: doc.aspectRatio,
    videoUrl: doc.videoUrl,
    source: doc.source,
    sourceType: doc.sourceType,
    authorName: doc.authorName,
    authorHandle: doc.authorHandle,
    authorUrl: doc.authorUrl,
    tags: doc.tags,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

export async function toViews(ctx: QueryCtx, docs: Doc<"artifacts">[]): Promise<ArtifactView[]> {
  return await Promise.all(docs.map((doc) => toView(ctx, doc)));
}
