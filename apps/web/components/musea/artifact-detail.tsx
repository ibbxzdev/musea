"use client";

import { ArrowUpRight, Bookmark, Play } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { galleriesForArtifact, isOwnArtifact } from "@/lib/musea/fixtures";
import { formatRelativeDate } from "@/lib/musea/format";
import { isSourceDirectable, KIND_LABELS, SOURCE_LABELS } from "@/lib/musea/sources";
import type { Artifact } from "@/lib/musea/types";
import { ResponsiveModal } from "./responsive-modal";
import { SourceMark } from "./source-badge";

/**
 * Everything Musea knows about one artifact: the media, the AI-written title and
 * summary, the tags it was filed under, where it came from and when it was saved.
 *
 * The native app splits this across a viewer and a "Show Description" sheet because a
 * phone screen cannot hold both. A scrolling sheet can, so it is one surface here.
 */
export function ArtifactDetail({
  artifact,
  onOpenChange,
}: {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
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
      {artifact && <ArtifactDetailBody artifact={artifact} />}
    </ResponsiveModal>
  );
}

function ArtifactDetailBody({ artifact }: { artifact: Artifact }) {
  const galleries = galleriesForArtifact(artifact);
  const directable = isSourceDirectable(artifact.sourceType) && Boolean(artifact.source);

  return (
    <article className="pb-safe px-5 pb-6 sm:px-6">
      {artifact.imageUrl && (
        <div
          className="relative w-full overflow-hidden rounded-2xl bg-muted"
          style={{ aspectRatio: artifact.aspectRatio ?? 1 }}
        >
          <Image
            src={artifact.imageUrl}
            alt={artifact.title}
            fill
            sizes="(min-width: 640px) 32rem, 100vw"
            className="object-cover"
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
          Saved {formatRelativeDate(artifact.savedAt)}
        </span>
      </div>

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

      <section className="mt-6 border-t pt-4">
        {!isOwnArtifact(artifact) ? (
          // Somebody else's save — it was never filed in a gallery of yours, so offering
          // to copy it is the only honest thing this section can say.
          <Button variant="secondary" className="h-11 w-full rounded-full">
            <Bookmark aria-hidden className="size-4" />
            Save to my library
          </Button>
        ) : (
          <>
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Bookmark aria-hidden className="size-4 text-muted-foreground" />
              In your galleries
            </h3>
            {galleries.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {galleries.map((gallery) => (
                  <li key={gallery.id}>
                    <Badge variant="outline" className="rounded-full px-3 py-1 font-normal">
                      {gallery.title}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Not filed yet. Musea will pick a gallery once enrichment finishes.
              </p>
            )}
          </>
        )}
      </section>
    </article>
  );
}
