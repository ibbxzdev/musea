"use client";

import type { Artifact } from "@/lib/musea/types";
import { ArtifactCard } from "./artifact-card";

/**
 * The masonry grid.
 *
 * CSS multi-column rather than a measuring layout library: every tile declares its
 * aspect ratio up front, so the browser can pack the columns on the server render with
 * no JavaScript, no measurement pass and no layout shift when the pictures arrive.
 * When this grid has to virtualise thousands of saves, `masonic` is the upgrade path.
 */
export function ArtifactGrid({
  artifacts,
  onOpen,
}: {
  artifacts: Artifact[];
  onOpen: (artifact: Artifact) => void;
}) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} onOpen={onOpen} />
      ))}
    </div>
  );
}
