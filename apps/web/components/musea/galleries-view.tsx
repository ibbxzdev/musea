"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { FolderPlus, SearchX } from "lucide-react";
import * as React from "react";
import { formatCount } from "@/lib/musea/format";
import { CreateGalleryButton } from "./create-gallery";
import { EmptyState } from "./empty-state";
import { GalleryCard } from "./gallery-card";
import { SearchField } from "./search-field";

/**
 * Your galleries.
 *
 * The whole list in one read: `galleries.listMine` takes at most 100, and the search is
 * a filter over what is already on the client rather than a round trip. A curator with
 * more than a hundred galleries is a different screen, not a bigger `take`.
 */
export function GalleriesView() {
  const galleries = useQuery(api.galleries.listMine, {});
  const [query, setQuery] = React.useState("");

  const normalised = query.trim().toLowerCase();
  const matches = galleries?.filter((gallery) => gallery.title.toLowerCase().includes(normalised));

  return (
    <div>
      <h1 className="sr-only">Galleries</h1>

      <SearchField
        value={query}
        onValueChange={setQuery}
        placeholder="Search galleries"
        className="mb-4 max-w-md"
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {galleries ? formatCount(galleries.length, "gallery", "galleries") : " "}
        </p>
        <CreateGalleryButton className="h-9 px-4" />
      </div>

      {matches === undefined ? (
        <GalleryGridSkeleton />
      ) : matches.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {matches.map((gallery) => (
            <GalleryCard key={gallery._id} gallery={gallery} />
          ))}
        </div>
      ) : normalised ? (
        <EmptyState icon={SearchX} title="No galleries" description="Try a different search." />
      ) : (
        <EmptyState
          icon={FolderPlus}
          title="No galleries yet"
          description="A gallery is how a pile of saves becomes a collection."
          action={<CreateGalleryButton variant="default" />}
        />
      )}
    </div>
  );
}

export function GalleryGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
        <div key={index}>
          <div className="aspect-square w-full animate-pulse rounded-2xl bg-muted" />
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-1.5 h-3 w-1/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
