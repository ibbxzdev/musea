"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { FolderX, Globe, Images, Loader2, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { absoluteUrl, copyLink } from "@/lib/musea/clipboard";
import { formatCount } from "@/lib/musea/format";
import type { Artifact } from "@/lib/musea/types";
import { ArtifactDetail } from "./artifact-detail";
import { ArtifactGrid, ArtifactGridSkeleton } from "./artifact-grid";
import { EditGalleryModal } from "./edit-gallery";
import { EmptyState } from "./empty-state";
import { PanelHeader } from "./panel-header";

const PAGE_SIZE = 24;

/**
 * One of your galleries.
 *
 * Its own route, so it has a URL, a back button and a shareable link — in the first web
 * port this was a piece of React state inside the Galleries tab, which meant the drill-in
 * vanished the moment you looked at another tab.
 */
export function GalleryDetailView({ galleryId }: { galleryId: Id<"galleries"> }) {
  const router = useRouter();

  const gallery = useQuery(api.galleries.get, { galleryId });
  const artifacts = usePaginatedQuery(
    api.galleryArtifacts.listArtifacts,
    { galleryId },
    { initialNumItems: PAGE_SIZE },
  );

  const updateGallery = useMutation(api.galleries.update);
  const removeGallery = useMutation(api.galleries.remove);
  const removeFromGallery = useMutation(api.galleryArtifacts.removeFromGallery);

  const [openArtifact, setOpenArtifact] = React.useState<Artifact | null>(null);
  const [editing, setEditing] = React.useState(false);

  if (gallery === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
        <ArtifactGridSkeleton count={6} />
      </div>
    );
  }

  // Also what a private gallery looks like to someone who is not its owner — deliberately
  // the same answer as a deleted one, so the page cannot be used to probe for ids.
  if (gallery === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Gallery not found"
        description="It may have been deleted, or it was never yours to open."
      />
    );
  }

  /**
   * Copy the link a *stranger* would use, which is the Community one — not this page.
   *
   * `/app/galleries/<id>` is the owner's view and resolves to "Gallery not found" for
   * anyone else, so sharing it would hand out a link that is dead for its recipient while
   * working perfectly for whoever copied it. The worst kind of broken.
   *
   * A private gallery still copies rather than refusing: wanting the link before flipping
   * the switch is a reasonable order to do things in. The toast is what keeps it honest,
   * because the link genuinely does not work for anyone else yet.
   */
  const copyGalleryLink = () =>
    copyLink(
      absoluteUrl(`/app/community/${galleryId}`),
      "Link copied",
      gallery.isPublic
        ? "Anyone with the link can open this gallery."
        : "This gallery is private — make it public before sharing.",
    );

  const togglePublic = async () => {
    try {
      await updateGallery({ galleryId, isPublic: !gallery.isPublic });
      toast.success(gallery.isPublic ? "Gallery is private again" : "Gallery is public");
    } catch {
      toast.error("Could not change that.");
    }
  };

  const deleteGallery = async () => {
    try {
      await removeGallery({ galleryId });
      // Navigate first, then say so: the gallery's own subscription resolves to null the
      // instant the mutation lands, and staying here would flash "not found".
      router.push("/app/galleries");
      toast.success("Gallery deleted", {
        description: "The saves in it are still in your library.",
      });
    } catch {
      toast.error("Could not delete that gallery.");
    }
  };

  const unfile = async (artifact: Artifact) => {
    try {
      await removeFromGallery({ galleryId, artifactIds: [artifact._id] });
      toast.success("Removed from gallery");
    } catch {
      toast.error("Could not remove that.");
    }
  };

  return (
    <div>
      <PanelHeader
        backHref="/app/galleries"
        backLabel="Galleries"
        title={gallery.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatCount(gallery.saveCount, "save")}</span>
            {gallery.isPublic && (
              <span className="inline-flex items-center gap-1 text-stellar">
                <Globe aria-hidden className="size-3.5" />
                Public
              </span>
            )}
            {gallery.description && (
              <span className="block w-full text-pretty">{gallery.description}</span>
            )}
          </span>
        }
        action={
          gallery.isOwn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full">
                  <MoreHorizontal className="size-5" />
                  <span className="sr-only">Gallery options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setEditing(true)}>Edit gallery</DropdownMenuItem>
                <DropdownMenuItem onSelect={copyGalleryLink}>Copy link</DropdownMenuItem>
                <DropdownMenuItem onSelect={togglePublic}>
                  {gallery.isPublic ? "Make private" : "Make public"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={deleteGallery}>
                  Delete gallery
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      {artifacts.status === "LoadingFirstPage" ? (
        <ArtifactGridSkeleton count={6} />
      ) : artifacts.results.length > 0 ? (
        <>
          <ArtifactGrid
            artifacts={artifacts.results}
            onOpen={setOpenArtifact}
            actions={
              gallery.isOwn ? { onDelete: unfile, deleteLabel: "Remove from gallery" } : undefined
            }
          />
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
          description="Nothing filed here yet. Use “Add to gallery” on any save."
        />
      )}

      <ArtifactDetail
        artifact={openArtifact}
        onOpenChange={(open) => !open && setOpenArtifact(null)}
        showFilings={gallery.isOwn}
      />
      <EditGalleryModal gallery={gallery} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
