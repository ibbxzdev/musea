import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import type { Route } from "next";

/**
 * The header of a drilled-into page.
 *
 * The back control is a chevron plus the name of where it goes, which is the iOS
 * convention — never the word "Back". It is a `<Link>` to that section rather than
 * `router.back()`: this page has a URL of its own now, so someone can arrive at it from
 * a link, and history-back would take them off the site.
 */
export function PanelHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  action,
}: {
  backHref: Route;
  backLabel: string;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <Link
        href={backHref}
        className="-ml-2 inline-flex h-11 items-center gap-0.5 pr-3 pl-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {backLabel}
      </Link>

      <div className="mt-1 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}
