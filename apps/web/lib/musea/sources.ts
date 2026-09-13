import type { ArtifactKind, SourceType } from "./types";

export const SOURCE_LABELS: Record<SourceType, string> = {
  pinterest: "Pinterest",
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
  tiktok: "TikTok",
  instagram: "Instagram",
  gallery: "Photos",
  files: "Files",
  link: "Link",
  note: "Note",
};

/**
 * Brand-ish tint for the source chip, as a Tailwind class pair.
 *
 * Deliberately a letter badge rather than a brand logo: shipping other companies' marks
 * into this repo is a licensing question nobody has asked, and the native app loads them
 * from its own asset bundle. A tinted initial reads the same at 20px.
 */
export const SOURCE_BADGE_CLASS: Record<SourceType, string> = {
  pinterest: "bg-red-500/15 text-red-600 dark:text-red-400",
  x: "bg-neutral-500/15 text-neutral-700 dark:text-neutral-300",
  youtube: "bg-red-500/15 text-red-600 dark:text-red-400",
  reddit: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  tiktok: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  instagram: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  gallery: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  files: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  link: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  note: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};

/** Sources that point at a page worth opening. The rest have nowhere to go. */
const DIRECTABLE: readonly SourceType[] = [
  "pinterest",
  "x",
  "youtube",
  "reddit",
  "tiktok",
  "instagram",
  "link",
];

export function isSourceDirectable(sourceType: SourceType): boolean {
  return DIRECTABLE.includes(sourceType);
}

export const KIND_LABELS: Record<ArtifactKind, string> = {
  image: "Image",
  video: "Video",
  note: "Note",
  link: "Link",
};

/** Filter chips, in the order the app shows them. */
export const KIND_FILTERS: readonly ArtifactKind[] = ["image", "video", "note", "link"];
