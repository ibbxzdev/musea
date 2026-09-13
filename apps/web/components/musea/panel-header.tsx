"use client";

import { ChevronLeft } from "lucide-react";
import type * as React from "react";

/**
 * The header of a drilled-into view.
 *
 * A tab on iOS keeps its own navigation stack, so going into a gallery pushes a screen
 * inside that tab rather than replacing the whole shell. The back control is a chevron
 * plus the name of where it goes, which is the iOS convention — never the word "Back".
 */
export function PanelHeader({
  backLabel,
  onBack,
  title,
  subtitle,
  action,
}: {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-11 items-center gap-0.5 pr-3 pl-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {backLabel}
      </button>

      <div className="mt-1 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-balance">{title}</h2>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}
