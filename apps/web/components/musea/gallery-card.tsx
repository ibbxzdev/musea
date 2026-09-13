"use client";

import { Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { communityCoverUrls, galleryCoverUrls } from "@/lib/musea/fixtures";
import { formatCount, initialsOf } from "@/lib/musea/format";
import type { CommunityGallery, Gallery } from "@/lib/musea/types";
import { GalleryCover } from "./gallery-cover";

/** A gallery you own. Auto-filed ones carry the sparkle until you claim them. */
export function GalleryCard({
  gallery,
  onOpen,
}: {
  gallery: Gallery;
  onOpen: (gallery: Gallery) => void;
}) {
  const covers = galleryCoverUrls(gallery);

  return (
    <button
      type="button"
      onClick={() => onOpen(gallery)}
      className="group w-full text-left focus-visible:outline-none"
    >
      <span className="relative block">
        <GalleryCover
          imageUrls={covers}
          className="transition-transform duration-200 group-active:scale-[0.98] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
        />
        {gallery.isAuto && (
          <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-background/85 backdrop-blur-sm">
            <Sparkles aria-hidden className="size-3.5 text-stellar" />
            <span className="sr-only">Filed automatically</span>
          </span>
        )}
      </span>
      <span className="mt-2 block truncate text-sm font-semibold tracking-tight">
        {gallery.title}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatCount(gallery.artifactIds.length, "save")}
      </span>
    </button>
  );
}

/** Someone else's gallery. Same cover, but the curator is the headline, not the count. */
export function CommunityGalleryCard({
  gallery,
  onOpen,
}: {
  gallery: CommunityGallery;
  onOpen: (gallery: CommunityGallery) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(gallery)}
      className="group w-full text-left focus-visible:outline-none"
    >
      <GalleryCover
        imageUrls={communityCoverUrls(gallery.id)}
        className="transition-transform duration-200 group-active:scale-[0.98] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
      />
      <span className="mt-2 block truncate text-sm font-semibold tracking-tight">
        {gallery.title}
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <Avatar className="size-5">
          <AvatarImage src={gallery.curator.avatarUrl} alt="" />
          <AvatarFallback className="text-[9px]">{initialsOf(gallery.curator.name)}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground">@{gallery.curator.handle}</span>
        <span aria-hidden className="text-xs text-muted-foreground">
          ·
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{gallery.saveCount}</span>
      </span>
    </button>
  );
}
