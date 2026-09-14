"use client";

import { Globe } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatCount, initialsOf } from "@/lib/musea/format";
import type { GalleryCard as GalleryCardData } from "@/lib/musea/types";
import { GalleryCover } from "./gallery-cover";

const CARD_PRESS =
  "transition-transform duration-200 group-active:scale-[0.98] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background";

/**
 * A gallery you own.
 *
 * A `<Link>`, not a button with an onClick: opening a gallery is navigation now, so it
 * gets a URL, a middle-click, and a back button. The badge marks the ones you have
 * published — the native app's sparkle marked auto-filed galleries, which no longer
 * exist here because the auto-filer was an AI feature.
 */
export function GalleryCard({ gallery }: { gallery: GalleryCardData }) {
  return (
    <Link
      href={`/app/galleries/${gallery._id}`}
      className="group w-full text-left focus-visible:outline-none"
    >
      <span className="relative block">
        <GalleryCover imageUrls={gallery.coverImageUrls} className={CARD_PRESS} />
        {gallery.isPublic && (
          <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-background/85 backdrop-blur-sm">
            <Globe aria-hidden className="size-3.5 text-stellar" />
            <span className="sr-only">Public gallery</span>
          </span>
        )}
      </span>
      <span className="mt-2 block truncate text-sm font-semibold tracking-tight">
        {gallery.title}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatCount(gallery.saveCount, "save")}
      </span>
    </Link>
  );
}

/** Someone else's gallery. Same cover, but the curator is the headline, not the count. */
export function CommunityGalleryCard({ gallery }: { gallery: GalleryCardData }) {
  const curator = gallery.owner;

  return (
    <Link
      href={`/app/community/${gallery._id}`}
      className="group w-full text-left focus-visible:outline-none"
    >
      <GalleryCover imageUrls={gallery.coverImageUrls} className={CARD_PRESS} />
      <span className="mt-2 block truncate text-sm font-semibold tracking-tight">
        {gallery.title}
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <Avatar className="size-5">
          <AvatarImage src={curator?.imageUrl} alt="" />
          <AvatarFallback className="text-[9px]">{initialsOf(curator?.name ?? "?")}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground">
          @{curator?.handle ?? "unknown"}
        </span>
        <span aria-hidden className="text-xs text-muted-foreground">
          ·
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{gallery.saveCount}</span>
      </span>
    </Link>
  );
}
