/**
 * Shapes for the Musea browse UI.
 *
 * These mirror the `artificats` / `gallery` tables in the Musea app, trimmed to what the
 * web UI actually renders. They are deliberately decoupled from `convex/schema.ts` here:
 * this is the presentation contract, and Story 3.x maps real documents onto it.
 */

/** Where an artifact came from. Decided once at save time, never re-derived at render. */
export type SourceType =
  | "pinterest"
  | "x"
  | "youtube"
  | "reddit"
  | "tiktok"
  | "instagram"
  | "gallery"
  | "files"
  | "link"
  | "note";

/** What an artifact *is*, which decides how its card renders. */
export type ArtifactKind = "image" | "video" | "note" | "link";

/** Enrichment state. `pending` and `failed` get a badge on the card. */
export type ArtifactStatus = "pending" | "ready" | "failed";

export type Artifact = {
  id: string;
  kind: ArtifactKind;
  title: string;
  description?: string;
  tags: string[];
  /** Thumbnail. Absent on notes, which render as type. */
  imageUrl?: string;
  /**
   * width ÷ height of the thumbnail. Set on every image so the masonry column reserves
   * the right box before the image loads — no reflow, no cumulative layout shift.
   */
  aspectRatio?: number;
  /** Original URL, when there is one to go back to. */
  source?: string;
  sourceType: SourceType;
  /** ISO date. Rendered relatively — see formatRelativeDate. */
  savedAt: string;
  galleryIds: string[];
  status: ArtifactStatus;
};

export type Gallery = {
  id: string;
  title: string;
  description?: string;
  /** Galleries the auto-filer created get a sparkle badge until they're claimed. */
  isAuto: boolean;
  artifactIds: string[];
};

export type Curator = {
  name: string;
  handle: string;
  /** Falls back to initials when absent. */
  avatarUrl?: string;
};

export type CommunityGallery = {
  id: string;
  title: string;
  description?: string;
  curator: Curator;
  /** Total saves in the gallery. More than the handful the browse view renders. */
  saveCount: number;
  followerCount: number;
};

export type Profile = Curator & {
  bio?: string;
  joinedAt: string;
};
