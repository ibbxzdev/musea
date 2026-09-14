"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { SearchX, Users } from "lucide-react";
import * as React from "react";
import { CommunityGalleryCard } from "./gallery-card";
import { EmptyState } from "./empty-state";
import { GalleryGridSkeleton } from "./galleries-view";
import { SearchField } from "./search-field";

/**
 * Public galleries from every curator.
 *
 * The one section that reads without a session — someone following a shared link should
 * land on the gallery, not on a sign-in form. `galleries.listPublic` returns only the
 * galleries whose owners have turned `isPublic` on; nothing here can see a private one.
 *
 * The phone app has no equivalent screen. This is the web app's own, and it is also the
 * surface the Stellar tipping work (Epic 3) hangs off: you cannot tip a curator for a
 * gallery you cannot open.
 */
export function CommunityView() {
  const galleries = useQuery(api.galleries.listPublic, {});
  const [query, setQuery] = React.useState("");

  const normalised = query.trim().toLowerCase();
  const matches = galleries?.filter((gallery) =>
    [gallery.title, gallery.owner?.name ?? "", gallery.owner?.handle ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalised),
  );

  return (
    <div>
      <h1 className="sr-only">Community</h1>

      <SearchField
        value={query}
        onValueChange={setQuery}
        placeholder="Search curators"
        className="mb-4 max-w-md"
      />

      <p className="mb-4 text-sm text-muted-foreground">Public galleries from other curators.</p>

      {matches === undefined ? (
        <GalleryGridSkeleton />
      ) : matches.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {matches.map((gallery) => (
            <CommunityGalleryCard key={gallery._id} gallery={gallery} />
          ))}
        </div>
      ) : normalised ? (
        <EmptyState
          icon={SearchX}
          title="No galleries"
          description="No curator or gallery matches that search."
        />
      ) : (
        <EmptyState
          icon={Users}
          title="Nothing public yet"
          description="Galleries appear here once a curator makes one public."
        />
      )}
    </div>
  );
}
