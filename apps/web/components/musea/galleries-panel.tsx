"use client";

import { FolderPlus, Images, Plus, SearchX, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { artifactsInGallery, GALLERIES } from "@/lib/musea/fixtures";
import { formatCount } from "@/lib/musea/format";
import type { Artifact, Gallery } from "@/lib/musea/types";
import { ArtifactGrid } from "./artifact-grid";
import { EmptyState } from "./empty-state";
import { GalleryCard } from "./gallery-card";
import { PanelHeader } from "./panel-header";

export function GalleriesPanel({
  query,
  openGalleryId,
  onOpenGallery,
  onOpenArtifact,
}: {
  query: string;
  /** Lifted to the shell so the drill-down survives a trip to another tab. */
  openGalleryId: string | null;
  onOpenGallery: (galleryId: string | null) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const openGallery = GALLERIES.find((gallery) => gallery.id === openGalleryId) ?? null;

  if (openGallery) {
    return (
      <GalleryDetail
        gallery={openGallery}
        onBack={() => onOpenGallery(null)}
        onOpenArtifact={onOpenArtifact}
      />
    );
  }

  const normalisedQuery = query.trim().toLowerCase();
  const galleries = GALLERIES.filter((gallery) =>
    gallery.title.toLowerCase().includes(normalisedQuery),
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {formatCount(GALLERIES.length, "gallery", "galleries")}
        </p>
        <Button variant="secondary" size="sm" className="h-9 rounded-full">
          <Plus className="size-4" />
          New gallery
        </Button>
      </div>

      {galleries.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {galleries.map((gallery) => (
            <GalleryCard
              key={gallery.id}
              gallery={gallery}
              onOpen={(selected) => onOpenGallery(selected.id)}
            />
          ))}
        </div>
      ) : normalisedQuery ? (
        <EmptyState icon={SearchX} title="No galleries" description="Try a different search." />
      ) : (
        <EmptyState
          icon={FolderPlus}
          title="No galleries yet"
          description="Create one, or let Musea file your saves into galleries for you."
        />
      )}
    </div>
  );
}

function GalleryDetail({
  gallery,
  onBack,
  onOpenArtifact,
}: {
  gallery: Gallery;
  onBack: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const artifacts = artifactsInGallery(gallery.id);

  return (
    <div>
      <PanelHeader
        backLabel="Galleries"
        onBack={onBack}
        title={gallery.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatCount(artifacts.length, "save")}</span>
            {gallery.isAuto && (
              <span className="inline-flex items-center gap-1 text-stellar">
                <Sparkles aria-hidden className="size-3.5" />
                Auto-filed
              </span>
            )}
            {gallery.description && (
              <span className="block w-full text-pretty">{gallery.description}</span>
            )}
          </span>
        }
      />

      {artifacts.length > 0 ? (
        <ArtifactGrid artifacts={artifacts} onOpen={onOpenArtifact} />
      ) : (
        <EmptyState
          icon={Images}
          title="Empty gallery"
          description="Nothing filed here yet. Add saves from any artifact's menu."
        />
      )}
    </div>
  );
}
