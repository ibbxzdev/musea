"use client";

import { Loader2, MoreHorizontal, Play, TriangleAlert } from "lucide-react";
import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyLink } from "@/lib/musea/clipboard";
import type { Artifact } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { SourceMark } from "./source-badge";

/**
 * Sources whose mark is worth showing on the tile.
 *
 * A picture you took yourself or dragged in from Files came from nowhere in particular —
 * marking those puts a chip on nearly every tile and stops the chip meaning anything.
 */
const MARKED_SOURCES = new Set<Artifact["sourceType"]>([
  "pinterest",
  "x",
  "youtube",
  "reddit",
  "tiktok",
  "instagram",
]);

export type ArtifactCardActions = {
  onAddToGallery?: (artifact: Artifact) => void;
  onDelete?: (artifact: Artifact) => void;
  /**
   * What the destructive item says. It is "Delete artifact" in the library and "Remove
   * from gallery" inside one, because those are genuinely different acts — un-filing a
   * save must not read as though it will destroy it.
   */
  deleteLabel?: string;
};

export function ArtifactCard({
  artifact,
  onOpen,
  actions,
}: {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
  actions?: ArtifactCardActions;
}) {
  const isNote = artifact.kind === "note";

  return (
    <div className="group relative mb-3 break-inside-avoid">
      <button
        type="button"
        onClick={() => onOpen(artifact)}
        className="block w-full overflow-hidden rounded-2xl bg-muted text-left transition-[transform,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:scale-[0.985]"
      >
        {isNote || !artifact.imageUrl ? (
          <NoteTile artifact={artifact} />
        ) : (
          <MediaTile artifact={artifact} />
        )}
        <span className="sr-only">Open {artifact.title}</span>
      </button>

      {(actions?.onAddToGallery || actions?.onDelete) && (
        <ArtifactMenu artifact={artifact} actions={actions} />
      )}
    </div>
  );
}

/**
 * A tile with no picture, so the type is the picture.
 *
 * Also the fallback for a link whose page published no `og:image`, and for one still
 * being scraped — both of which are common enough that a grey box would be the most
 * frequent thing in the grid.
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
      <StatusChip status={artifact.status} className="mt-auto self-start" />
    </span>
  );
}

/**
 * What an unmeasured tile reserves until its picture arrives.
 *
 * Slightly taller than wide, which is the commonest shape for a scraped `og:image` and
 * reads as a card rather than a banner. The exact number matters far less than *having*
 * one — see below.
 */
const UNMEASURED_TILE_RATIO = 4 / 5;

function MediaTile({ artifact }: { artifact: Artifact }) {
  // A link or a video is not self-describing — a photograph is. Caption only the first two.
  const showCaption = artifact.kind === "link" || artifact.kind === "video";

  /**
   * The picture's real shape, learned from the image itself.
   *
   * Only ever used for artifacts that arrived without a declared `aspectRatio` — a scraped
   * `og:image` has no size in the markup, so this is the only way to know it.
   */
  const [measured, setMeasured] = React.useState<number | null>(null);
  const ratio = artifact.aspectRatio ?? measured ?? UNMEASURED_TILE_RATIO;

  return (
    <span
      className="relative block w-full"
      /**
       * **Always set, never undefined.** An upload carries its ratio because the browser
       * measured it at pick time; a scraped `og:image` does not, and those tiles used to
       * render with no reserved height at all — `h-auto` on an image that has not loaded
       * is a box 0px tall.
       *
       * That is what made the grid move things around. This is a CSS multi-column
       * container, and the browser *balances* it: it re-runs the distribution whenever the
       * content's measurements change, and is free to move an item into a different column
       * when it does. With zero-height tiles at first paint, every image that finished
       * loading was another re-balance — so a tile you were about to click could be
       * somewhere else by the time you clicked it.
       *
       * Reserving a box up front means the heights the balancer sees at first paint are
       * the heights it keeps.
       */
      style={{ aspectRatio: ratio }}
    >
      {/*
        A plain <img>, not next/image. These are third-party thumbnails from whatever host
        the user saved from, so using the optimiser would mean allowing every remote host
        in next.config — which turns the deployment into an open image proxy anyone can
        point at anything. Not worth it for a grid of thumbnails.
      */}
      {/* biome-ignore lint/performance/noImgElement: arbitrary remote hosts, see above */}
      <img
        src={artifact.imageUrl}
        alt={artifact.title}
        loading="lazy"
        decoding="async"
        onLoad={
          artifact.aspectRatio
            ? undefined
            : (event) => {
                // Adopt the picture's true shape once, so an unmeasured tile is not stuck
                // at the placeholder ratio forever. Guarded on `naturalHeight` because a
                // broken image reports 0 and would set an infinite ratio.
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalHeight > 0) setMeasured(naturalWidth / naturalHeight);
              }
        }
        className="absolute inset-0 h-full w-full object-cover"
      />

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

function StatusChip({ status, className }: { status: Artifact["status"]; className?: string }) {
  if (status === "ready") return null;

  const pending = status === "pending";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm",
        className,
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className="size-3 animate-spin" />
      ) : (
        <TriangleAlert aria-hidden className="size-3 text-amber-500" />
      )}
      {pending ? "Reading the page…" : "Could not read that link"}
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
function ArtifactMenu({ artifact, actions }: { artifact: Artifact; actions: ArtifactCardActions }) {
  // Hoisted so the `source &&` guard below narrows it for the copy handler too. Narrowing
  // a property access does not survive into a callback, and the alternative is a cast that
  // would keep compiling if `source` ever stopped being guaranteed here.
  const source = artifact.source;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          /**
           * `pointer-events` tracks the opacity, and that pairing is the whole point.
           *
           * An `opacity: 0` element is invisible but still takes clicks. This button is
           * 44×44 and sits in the top-right corner of every tile, so on a pointer device
           * each card had an invisible dead zone that swallowed the click meant to open
           * the artifact — you click the picture, nothing opens, and there is nothing on
           * screen to explain why. Hiding it has to mean hiding it from the pointer too.
           *
           * The touch case is unaffected: there is no hover, so it stays at `opacity-100`
           * and `pointer-events-auto` below `sm`.
           */
          className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full text-white opacity-100 transition-opacity focus-visible:opacity-100 sm:pointer-events-none sm:opacity-0 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
            <MoreHorizontal className="size-4" />
          </span>
          <span className="sr-only">Actions for {artifact.title}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.onAddToGallery && (
          <DropdownMenuItem onSelect={() => actions.onAddToGallery?.(artifact)}>
            Add to gallery
          </DropdownMenuItem>
        )}
        {/*
          Both items are gated on `source` because an artifact does not always have one —
          an uploaded image has no page to go back to, and "Copy link" with nothing to copy
          is worse than an item that is not there.

          The link copied is the *original* source URL, not a Musea one: artifacts have no
          route of their own (they open in a modal over whichever grid you were in), so
          there is no per-artifact address to share.
        */}
        {source && (
          <>
            <DropdownMenuItem asChild>
              <a href={source} target="_blank" rel="noreferrer noopener">
                Open original
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyLink(source, "Link copied")}>
              Copy link
            </DropdownMenuItem>
          </>
        )}
        {actions.onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete?.(artifact)}>
              {actions.deleteLabel ?? "Delete artifact"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
