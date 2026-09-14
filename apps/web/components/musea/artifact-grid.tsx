"use client";

import type { Artifact } from "@/lib/musea/types";
import { ArtifactCard, type ArtifactCardActions } from "./artifact-card";

/**
 * The masonry grid.
 *
 * CSS multi-column rather than a measuring layout library: the browser packs the columns
 * with no JavaScript, no measurement pass and no layout shift beyond what an unmeasured
 * thumbnail costs. When this grid has to virtualise thousands of saves, `masonic` is the
 * upgrade path.
 */
export function ArtifactGrid({
  artifacts,
  onOpen,
  actions,
}: {
  artifacts: Artifact[];
  onOpen: (artifact: Artifact) => void;
  actions?: ArtifactCardActions;
}) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact._id} artifact={artifact} onOpen={onOpen} actions={actions} />
      ))}
    </div>
  );
}

/** Placeholder tiles at the heights real ones land at, so the first load does not jump. */
export function ArtifactGridSkeleton({ count = 8 }: { count?: number }) {
  const heights = [180, 260, 210, 300, 240, 190, 280, 220];

  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
          key={index}
          className="mb-3 animate-pulse break-inside-avoid rounded-2xl bg-muted"
          style={{ height: heights[index % heights.length] }}
        />
      ))}
    </div>
  );
}
