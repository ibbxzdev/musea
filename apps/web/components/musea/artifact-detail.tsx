"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { ArrowUpRight, Bookmark, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeDate } from "@/lib/musea/format";
import { isSourceDirectable, KIND_LABELS, SOURCE_LABELS } from "@/lib/musea/sources";
import type { Artifact } from "@/lib/musea/types";
import { ResponsiveModal } from "./responsive-modal";
import { SourceMark } from "./source-badge";

/**
 * Everything Musea knows about one artifact: the media, the title and summary its source
 * published, the tags it is filed under, where it came from and when it was saved.
 *
 * The native app splits this across a viewer and a "Show Description" sheet because a
 * phone screen cannot hold both. A scrolling sheet can, so it is one surface here.
 */
export function ArtifactDetail({
  artifact,
  onOpenChange,
  /** Off for someone else's gallery, where the filing list is not yours to see. */
  showFilings = true,
}: {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
  showFilings?: boolean;
}) {
  return (
    <ResponsiveModal
      open={artifact !== null}
      onOpenChange={onOpenChange}
      title={artifact?.title ?? "Artifact"}
      description={
        artifact
          ? `${KIND_LABELS[artifact.kind]} saved from ${SOURCE_LABELS[artifact.sourceType]}`
          : undefined
      }
      hideHeader
    >
      {artifact && <ArtifactDetailBody artifact={artifact} showFilings={showFilings} />}
    </ResponsiveModal>
  );
}

function ArtifactDetailBody({
  artifact,
  showFilings,
}: {
  artifact: Artifact;
  showFilings: boolean;
}) {
  /**
   * Skipped entirely rather than fetched-and-hidden when the filings are not ours to
   * show: the query throws for an artifact the caller does not own, and a rejected
   * subscription would surface as an error toast behind the sheet.
   */
  const galleries = useQuery(
    api.galleryArtifacts.listGalleriesForArtifact,
    showFilings ? { artifactId: artifact._id } : "skip",
  );

  const directable = isSourceDirectable(artifact.sourceType) && Boolean(artifact.source);

  return (
    <article className="pb-safe px-5 pb-6 sm:px-6">
      {artifact.imageUrl && (
        <div
          className="relative w-full overflow-hidden rounded-2xl bg-muted"
          style={artifact.aspectRatio ? { aspectRatio: artifact.aspectRatio } : undefined}
        >
          {/* biome-ignore lint/performance/noImgElement: arbitrary remote hosts — see artifact-card.tsx */}
          <img
            src={artifact.imageUrl}
            alt={artifact.title}
            className="w-full object-cover"
            decoding="async"
          />
          {artifact.kind === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                <Play aria-hidden className="size-6 translate-x-0.5 fill-white text-white" />
              </span>
            </span>
          )}
        </div>
      )}

      <h2 className="mt-5 text-2xl leading-tight font-bold tracking-tight text-balance">
        {artifact.title}
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-9 rounded-full pr-3 pl-2"
          disabled={!directable}
          asChild={directable}
        >
          {directable ? (
            <a href={artifact.source} target="_blank" rel="noreferrer noopener">
              <SourceMark sourceType={artifact.sourceType} className="size-5" />
              From {SOURCE_LABELS[artifact.sourceType]}
              <ArrowUpRight aria-hidden className="size-4 text-muted-foreground" />
            </a>
          ) : (
            <span>
              <SourceMark sourceType={artifact.sourceType} className="size-5" />
              From {SOURCE_LABELS[artifact.sourceType]}
            </span>
          )}
        </Button>
        <span className="text-sm text-muted-foreground">
          Saved {formatRelativeDate(artifact.createdAt)}
        </span>
      </div>

      {artifact.authorName && (
        <p className="mt-2 text-sm text-muted-foreground">
          By {artifact.authorName}
          {artifact.authorHandle && ` (@${artifact.authorHandle})`}
        </p>
      )}

      {artifact.description && (
        <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted-foreground">
          {artifact.description}
        </p>
      )}

      {artifact.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {artifact.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="rounded-full px-2.5 py-1 font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {showFilings && (
        <section className="mt-6 border-t pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Bookmark aria-hidden className="size-4 text-muted-foreground" />
            In your galleries
          </h3>
          {galleries === undefined ? (
            <div className="mt-3 h-6 w-40 animate-pulse rounded-full bg-muted" />
          ) : galleries.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {galleries.map((gallery) => (
                <li key={gallery._id}>
                  <Badge variant="outline" className="rounded-full px-3 py-1 font-normal">
                    {gallery.title}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Not filed anywhere yet. Use “Add to gallery” on the card.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
