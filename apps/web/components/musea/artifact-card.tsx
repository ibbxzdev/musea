"use client";

import { Loader2, MoreHorizontal, Play, TriangleAlert } from "lucide-react";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isOwnArtifact } from "@/lib/musea/fixtures";
import type { Artifact } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { SourceMark } from "./source-badge";

/** Widths the grid actually renders a tile at, so the browser fetches the right one. */
const THUMB_SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

/**
 * Sources whose mark is worth showing on the tile.
 *
 * A picture you took yourself or dragged in from Files came from nowhere in particular —
 * marking those adds a chip to nearly every tile and stops the chip meaning anything.
 */
const MARKED_SOURCES = new Set(["pinterest", "x", "youtube", "reddit", "tiktok", "instagram"]);

export function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
}) {
  const isNote = artifact.kind === "note";

  return (
    <div className="group relative mb-3 break-inside-avoid">
      <button
        type="button"
        onClick={() => onOpen(artifact)}
        className="block w-full overflow-hidden rounded-2xl bg-muted text-left transition-[transform,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:scale-[0.985]"
      >
        {isNote ? <NoteTile artifact={artifact} /> : <MediaTile artifact={artifact} />}
        <span className="sr-only">Open {artifact.title}</span>
      </button>

      <ArtifactMenu artifact={artifact} />
    </div>
  );
}

/**
 * A note has no picture, so the type is the picture.
 *
 * Spans throughout, not divs and paragraphs: the whole tile lives inside a `<button>`,
 * whose content model is phrasing content only.
 */
function NoteTile({ artifact }: { artifact: Artifact }) {
  return (
    <span className="flex min-h-40 flex-col gap-2 p-4">
      <span className="text-base leading-snug font-semibold tracking-tight">{artifact.title}</span>
      {artifact.description && (
        <span className="line-clamp-10 text-[13px] leading-relaxed text-muted-foreground">
          {artifact.description}
        </span>
      )}
    </span>
  );
}

function MediaTile({ artifact }: { artifact: Artifact }) {
  // A link or a video is not self-describing — a photograph is. Caption only the first two.
  const showCaption = artifact.kind === "link" || artifact.kind === "video";

  return (
    <span
      className="relative block w-full"
      // Set from the fixture rather than measured on load, so the column reserves the
      // right height before the image arrives and the grid never jumps.
      style={{ aspectRatio: artifact.aspectRatio ?? 1 }}
    >
      {artifact.imageUrl && (
        <Image
          src={artifact.imageUrl}
          alt={artifact.title}
          fill
          sizes={THUMB_SIZES}
          className="object-cover"
        />
      )}

      {artifact.kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Play aria-hidden className="size-5 translate-x-px fill-white text-white" />
          </span>
        </span>
      )}

      {MARKED_SOURCES.has(artifact.sourceType) && (
        <SourceMark
          sourceType={artifact.sourceType}
          className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm"
        />
      )}

      {/*
        Caption and status share one bottom stack. Positioning them independently put the
        "Could not process" chip straight through the title on a link card that had both.
      */}
      {(showCaption || artifact.status !== "ready") && (
        <span
          className={cn(
            "absolute inset-x-0 bottom-0 flex flex-col items-start gap-1.5 px-3 pb-3",
            showCaption && "bg-linear-to-t from-black/70 to-transparent pt-8",
          )}
        >
          <StatusChip status={artifact.status} />
          {showCaption && (
            <span className="line-clamp-2 text-[13px] leading-snug font-medium text-white">
              {artifact.title}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function StatusChip({ status }: { status: Artifact["status"] }) {
  if (status === "ready") return null;

  const pending = status === "pending";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
      {pending ? (
        <Loader2 aria-hidden className="size-3 animate-spin" />
      ) : (
        <TriangleAlert aria-hidden className="size-3 text-amber-500" />
      )}
      {pending ? "Organizing…" : "Could not process"}
    </span>
  );
}

/**
 * The long-press menu from the native card.
 *
 * Always in the DOM and always reachable by keyboard; it only fades in on hover so it
 * does not sit on top of every tile in the grid. On touch there is no hover, so it stays
 * visible — `group-hover` alone would make it unreachable on a phone.
 */
function ArtifactMenu({ artifact }: { artifact: Artifact }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full text-white opacity-100 transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
            <MoreHorizontal className="size-4" />
          </span>
          <span className="sr-only">Actions for {artifact.title}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {isOwnArtifact(artifact) ? (
          <>
            <DropdownMenuItem>Add to gallery</DropdownMenuItem>
            <DropdownMenuItem>Share</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Delete artifact</DropdownMenuItem>
          </>
        ) : (
          // Somebody else's save: you can take a copy, not manage theirs.
          <>
            <DropdownMenuItem>Save to my library</DropdownMenuItem>
            <DropdownMenuItem>Share</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
