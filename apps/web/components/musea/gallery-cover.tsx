import { Images } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A gallery's cover: up to three thumbnails in the same mosaic the native app uses —
 * one fills the square, two split it vertically, three put the first on the left and
 * stack the other two on the right.
 *
 * Built from spans so it can sit inside the `<button>` that makes a gallery card
 * pressable without producing invalid markup.
 */
export function GalleryCover({
  imageUrls,
  className,
}: {
  imageUrls: readonly string[];
  className?: string;
}) {
  return (
    <span
      className={cn("block aspect-square w-full overflow-hidden rounded-2xl bg-muted", className)}
    >
      <CoverMosaic imageUrls={imageUrls} />
    </span>
  );
}

/** Destructured rather than indexed so each branch hands `CoverTile` a defined src. */
function CoverMosaic({ imageUrls }: { imageUrls: readonly string[] }) {
  const [first, second, third] = imageUrls;

  if (!first) {
    return (
      <span className="flex size-full items-center justify-center">
        <Images aria-hidden className="size-7 text-muted-foreground/50" />
      </span>
    );
  }

  if (!second) return <CoverTile src={first} />;

  if (!third) {
    return (
      <span className="flex size-full gap-0.5">
        <CoverTile src={first} />
        <CoverTile src={second} />
      </span>
    );
  }

  return (
    <span className="flex size-full gap-0.5">
      <CoverTile src={first} />
      <span className="flex h-full flex-1 flex-col gap-0.5">
        <CoverTile src={second} />
        <CoverTile src={third} />
      </span>
    </span>
  );
}

function CoverTile({ src }: { src: string }) {
  return (
    <span className="relative block h-full flex-1 overflow-hidden bg-muted">
      {/* Decorative: the gallery title beside it already names the thing. A plain <img>
          for the same reason as the artifact tiles — see artifact-card.tsx. */}
      {/* biome-ignore lint/performance/noImgElement: arbitrary remote hosts */}
      <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
    </span>
  );
}
