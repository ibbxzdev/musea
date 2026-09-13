import { SOURCE_BADGE_CLASS, SOURCE_LABELS } from "@/lib/musea/sources";
import type { SourceType } from "@/lib/musea/types";
import { cn } from "@/lib/utils";

/** The tinted initial that stands in for a brand mark. See sources.ts for why. */
export function SourceMark({
  sourceType,
  className,
}: {
  sourceType: SourceType;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
        SOURCE_BADGE_CLASS[sourceType],
        className,
      )}
    >
      {SOURCE_LABELS[sourceType].charAt(0)}
    </span>
  );
}

/** Mark plus label, for the artifact viewer's "From YouTube" row. */
export function SourceBadge({
  sourceType,
  className,
}: {
  sourceType: SourceType;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SourceMark sourceType={sourceType} />
      <span className="text-sm font-medium">From {SOURCE_LABELS[sourceType]}</span>
    </span>
  );
}
