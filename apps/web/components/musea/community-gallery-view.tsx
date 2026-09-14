"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import { FolderX, Images, Loader2 } from "lucide-react";
import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatCount, initialsOf } from "@/lib/musea/format";
import type { Artifact } from "@/lib/musea/types";
import { ArtifactDetail } from "./artifact-detail";
import { ArtifactGrid, ArtifactGridSkeleton } from "./artifact-grid";
import { EmptyState } from "./empty-state";
import { GalleryTotalBadge } from "./gallery-total";
import { PanelHeader } from "./panel-header";
import { TipButton } from "./tip-sheet";

const PAGE_SIZE = 24;

/**
 * Somebody else's public gallery.
 *
 * Read-only by construction rather than by hiding buttons: every mutation in the backend
 * checks ownership, so there is nothing here to disable. No card menu, no filings list —
 * which galleries of *yours* an artifact is in is not a question about this page.
 *
 * It is also the only screen where tipping means anything: this is the one place you are
 * looking at a gallery that is not yours. Your own galleries reach the same component when
 * they are public, which is why the Tip button still checks `isOwn` for itself.
 */
export function CommunityGalleryView({ galleryId }: { galleryId: Id<"galleries"> }) {
  const gallery = useQuery(api.galleries.get, { galleryId });
  const artifacts = usePaginatedQuery(
    api.galleryArtifacts.listArtifacts,
    { galleryId },
    { initialNumItems: PAGE_SIZE },
  );

  const [openArtifact, setOpenArtifact] = React.useState<Artifact | null>(null);
  /**
   * Bumped when a tip settles, to ask the badge to re-read contract state. A counter
   * rather than a callback ref because the total is not ours to set — only the chain can
   * say what it is, and writing the new figure locally is exactly the shortcut that would
   * make the number unverifiable.
   */
  const [totalVersion, setTotalVersion] = React.useState(0);

  if (gallery === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
        <ArtifactGridSkeleton count={6} />
      </div>
    );
  }

  if (gallery === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Gallery not found"
        description="It may have been deleted, or its curator made it private."
      />
    );
  }

  const curator = gallery.owner;

  return (
    <div>
      <PanelHeader
        backHref="/app/community"
        backLabel="Community"
        title={gallery.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatCount(gallery.saveCount, "save")}</span>
            <GalleryTotalBadge galleryId={galleryId} version={totalVersion} />
            {gallery.description && (
              <span className="block w-full text-pretty">{gallery.description}</span>
            )}
          </span>
        }
      />

      {curator && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
          <Avatar className="size-10">
            <AvatarImage src={curator.imageUrl} alt="" />
            <AvatarFallback>{initialsOf(curator.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{curator.name}</p>
            <p className="truncate text-xs text-muted-foreground">@{curator.handle}</p>
          </div>
          {/* Next to the person being paid, not in the page chrome — the button means
              "support this curator", and a header action would read as a page control. */}
          <TipButton
            galleryId={galleryId}
            curatorName={curator.name}
            curatorHandle={curator.handle}
            isOwn={gallery.isOwn}
            onTipped={() => setTotalVersion((version) => version + 1)}
          />
        </div>
      )}

      {artifacts.status === "LoadingFirstPage" ? (
        <ArtifactGridSkeleton count={6} />
      ) : artifacts.results.length > 0 ? (
        <>
          <ArtifactGrid artifacts={artifacts.results} onOpen={setOpenArtifact} />
          {artifacts.status === "CanLoadMore" && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => artifacts.loadMore(PAGE_SIZE)}
                className="h-11 rounded-full px-6"
              >
                Load more
              </Button>
            </div>
          )}
          {artifacts.status === "LoadingMore" && (
            <div className="mt-6 flex justify-center text-muted-foreground">
              <Loader2 aria-label="Loading more" className="size-5 animate-spin" />
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={Images}
          title="Empty gallery"
          description="This curator has not filed anything here yet."
        />
      )}

      <ArtifactDetail
        artifact={openArtifact}
        onOpenChange={(open) => !open && setOpenArtifact(null)}
        showFilings={false}
      />
    </div>
  );
}
