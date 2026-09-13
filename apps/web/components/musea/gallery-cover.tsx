import { Images } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const COVER_SIZES = "(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 45vw";

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
  imageUrls: string[];
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
function CoverMosaic({ imageUrls }: { imageUrls: string[] }) {
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
      {/* Decorative: the gallery title beside it already names the thing. */}
      <Image src={src} alt="" fill sizes={COVER_SIZES} className="object-cover" />
    </span>
  );
}
