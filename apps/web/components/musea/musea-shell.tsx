"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { AddArtifactModal } from "./add-artifact";

/**
 * The Musea shell: title, save button, and the navigation between sections.
 *
 * The phone app uses a tab bar, and the first web port copied that with a Radix `Tabs`
 * root — one page, four panels, a `value` in React state. That is the wrong shape on the
 * web for reasons that are not cosmetic: an inactive Radix tab is unmounted, so every
 * panel lost its scroll position and its drill-down state on the way out; none of the
 * four had a URL, so nothing could be linked, bookmarked, or reached with the back
 * button; and every panel's data was fetched on first paint whether you looked at it or
 * not.
 *
 * So each section is a route, this is its layout, and navigation is `<Link>`. The rail
 * looks like a tab bar because that is the right affordance — it just isn't one.
 */

const SECTIONS = [
  { href: "/app/artifacts", label: "Artifacts" },
  { href: "/app/galleries", label: "Galleries" },
  { href: "/app/community", label: "Community" },
  { href: "/app/profile", label: "Profile" },
] as const;

export function MuseaShell({ children }: { children: React.ReactNode }) {
  const [addOpen, setAddOpen] = React.useState(false);
  const isDesktop = useIsDesktop();

  return (
    <div className="flex min-h-screen-safe flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-6xl px-5">
          <div className="flex items-center justify-between gap-3 pb-3">
            {/* iOS large title: 34px, bold, tight. */}
            <Link
              href="/app/artifacts"
              className="text-[34px] leading-none font-bold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Musea
            </Link>
            <Button
              onClick={() => setAddOpen(true)}
              size="icon"
              className="size-11 shrink-0 rounded-full"
            >
              <Plus className="size-5" />
              <span className="sr-only">Save to Musea</span>
            </Button>
          </div>

          {/* Below lg the rail lives in the header. A 10rem vertical rail would eat a
              quarter of a 390px screen. */}
          {!isDesktop && (
            <SectionNav className="w-full justify-start gap-4 overflow-x-auto pb-2 scrollbar-none" />
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-5 pt-5 pb-16">
        {isDesktop && (
          // top-28 clears the sticky header (large title only, since the rail moved out
          // of it at this width) with a little air.
          <SectionNav className="sticky top-28 h-fit w-fit shrink-0 flex-col items-start gap-1 self-start" />
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <AddArtifactModal open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function SectionNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className={cn("flex", className)}>
      {SECTIONS.map((section) => {
        // startsWith, not equality: /app/galleries/<id> is still the Galleries section.
        const active = pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // h-11 keeps every target on the 44px grid on touch.
              "inline-flex h-11 flex-none items-center rounded-md px-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:px-3",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              // The underline is the mobile rail's active mark; the desktop rail uses a
              // filled pill instead, because a vertical list of underlines reads as links.
              active && "border-b-2 border-foreground lg:border-b-0 lg:bg-muted",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
