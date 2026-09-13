"use client";

import { SearchX, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { communityArtifacts, COMMUNITY_GALLERIES } from "@/lib/musea/fixtures";
import { formatCount, initialsOf } from "@/lib/musea/format";
import type { Artifact, CommunityGallery } from "@/lib/musea/types";
import { ArtifactGrid } from "./artifact-grid";
import { CommunityGalleryCard } from "./gallery-card";
import { EmptyState } from "./empty-state";
import { PanelHeader } from "./panel-header";

export function CommunityPanel({
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
  const openGallery = COMMUNITY_GALLERIES.find((gallery) => gallery.id === openGalleryId) ?? null;

  if (openGallery) {
    return (
      <CommunityGalleryDetail
        gallery={openGallery}
        onBack={() => onOpenGallery(null)}
        onOpenArtifact={onOpenArtifact}
      />
    );
  }

  const normalisedQuery = query.trim().toLowerCase();
  const galleries = COMMUNITY_GALLERIES.filter((gallery) =>
    [gallery.title, gallery.curator.name, gallery.curator.handle]
      .join(" ")
      .toLowerCase()
      .includes(normalisedQuery),
  );

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Public galleries from other curators.</p>

      {galleries.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {galleries.map((gallery) => (
            <CommunityGalleryCard
              key={gallery.id}
              gallery={gallery}
              onOpen={(selected) => onOpenGallery(selected.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={SearchX}
          title="No galleries"
          description="No curator or gallery matches that search."
        />
      )}
    </div>
  );
}

function CommunityGalleryDetail({
  gallery,
  onBack,
  onOpenArtifact,
}: {
  gallery: CommunityGallery;
  onBack: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const artifacts = communityArtifacts(gallery.id);

  return (
    <div>
      <PanelHeader
        backLabel="Community"
        onBack={onBack}
        title={gallery.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatCount(gallery.saveCount, "save")}</span>
            <span aria-hidden>·</span>
            <span>{formatCount(gallery.followerCount, "follower")}</span>
            {gallery.description && (
              <span className="block w-full text-pretty">{gallery.description}</span>
            )}
          </span>
        }
        action={
          <Button variant="secondary" size="sm" className="h-9 shrink-0 rounded-full">
            <UserPlus className="size-4" />
            Follow
          </Button>
        }
      />

      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
        <Avatar className="size-10">
          <AvatarImage src={gallery.curator.avatarUrl} alt="" />
          <AvatarFallback>{initialsOf(gallery.curator.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{gallery.curator.name}</p>
          <p className="truncate text-xs text-muted-foreground">@{gallery.curator.handle}</p>
        </div>
      </div>

      <ArtifactGrid artifacts={artifacts} onOpen={onOpenArtifact} />
    </div>
  );
}
