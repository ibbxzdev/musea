"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowDownUp, Loader2, SearchX, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { KIND_FILTERS, KIND_LABELS } from "@/lib/musea/sources";
import type { Artifact, ArtifactKind } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { ArtifactDetail } from "./artifact-detail";
import { ArtifactGrid, ArtifactGridSkeleton } from "./artifact-grid";
import { EmptyState } from "./empty-state";
import { FileIntoGalleriesModal } from "./file-into-galleries";
import { SearchField } from "./search-field";

/** One screen of tiles. Enough to fill a desktop grid twice over before asking for more. */
const PAGE_SIZE = 24;

type SortDir = "desc" | "asc";

/**
 * The library.
 *
 * Two different reads behind one screen, and which one is live depends on whether there
 * is a search query:
 *
 *   - **Browsing** paginates `artifacts.list` over an index, so a library of any size
 *     costs one page per scroll.
 *   - **Searching** calls `artifacts.search`, which is Convex's full-text index over the
 *     denormalised `searchText` field and returns a single capped set. It replaces the
 *     phone app's embedding search, which needed an OpenAI call per query.
 *
 * Only one is subscribed at a time — `"skip"` is what keeps the idle one from running.
 */
export function ArtifactsView() {
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<ArtifactKind | "all">("all");
  const [sort, setSort] = React.useState<SortDir>("desc");

  const [openArtifact, setOpenArtifact] = React.useState<Artifact | null>(null);
  const [filingArtifact, setFilingArtifact] = React.useState<Artifact | null>(null);

  const removeArtifact = useMutation(api.artifacts.remove);

  // A query per keystroke would be a search-index read per keystroke.
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const searching = debouncedQuery.length > 0;
  const kindFilter = kind === "all" ? undefined : kind;

  const browsed = usePaginatedQuery(
    api.artifacts.list,
    searching ? "skip" : { kind: kindFilter, sortDir: sort },
    { initialNumItems: PAGE_SIZE },
  );

  const found = useQuery(
    api.artifacts.search,
    searching ? { query: debouncedQuery, kind: kindFilter } : "skip",
  );

  const artifacts = searching ? found : browsed.results;
  const loading = artifacts === undefined || (!searching && browsed.status === "LoadingFirstPage");

  const handleDelete = async (artifact: Artifact) => {
    try {
      await removeArtifact({ artifactId: artifact._id });
      toast.success("Deleted");
    } catch {
      toast.error("Could not delete that.");
    }
  };

  return (
    <div>
      <h1 className="sr-only">Artifacts</h1>

      <SearchField
        value={query}
        onValueChange={setQuery}
        placeholder="Search anything"
        className="mb-4 max-w-md"
      />

      <div className="mb-4 flex items-center gap-2">
        {/*
          Scrolls rather than wraps, so the grid always starts at the same y at 390px.
          The bleed is left-only: a negative right margin would slide the last chip under
          the sort button instead of stopping short of it.
        */}
        <div className="-ml-5 flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 pl-5 scrollbar-none sm:ml-0 sm:pl-0">
          <FilterChip active={kind === "all"} onClick={() => setKind("all")}>
            All
          </FilterChip>
          {KIND_FILTERS.map((value) => (
            <FilterChip key={value} active={kind === value} onClick={() => setKind(value)}>
              {KIND_LABELS[value]}
            </FilterChip>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              // Sorting a relevance-ranked result set would be meaningless, so the control
              // goes away rather than sitting there doing nothing.
              disabled={searching}
              className="size-11 shrink-0 rounded-full"
            >
              <ArrowDownUp className="size-4" />
              <span className="sr-only">Sort artifacts</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => setSort(value as SortDir)}
            >
              <DropdownMenuRadioItem value="desc">Newest first</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="asc">Oldest first</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading ? (
        <ArtifactGridSkeleton />
      ) : artifacts.length > 0 ? (
        <>
          <ArtifactGrid
            artifacts={artifacts}
            onOpen={setOpenArtifact}
            actions={{ onAddToGallery: setFilingArtifact, onDelete: handleDelete }}
          />

          {!searching && browsed.status === "CanLoadMore" && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => browsed.loadMore(PAGE_SIZE)}
                className="h-11 rounded-full px-6"
              >
                Load more
              </Button>
            </div>
          )}
          {!searching && browsed.status === "LoadingMore" && (
            <div className="mt-6 flex justify-center text-muted-foreground">
              <Loader2 aria-label="Loading more" className="size-5 animate-spin" />
            </div>
          )}
        </>
      ) : searching ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          description="Try different words — search looks at titles, summaries and tags."
        />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Nothing here yet"
          description="Paste a link, write a note, or pick an image. Use the + button up top."
        />
      )}

      <ArtifactDetail
        artifact={openArtifact}
        onOpenChange={(open) => !open && setOpenArtifact(null)}
      />
      <FileIntoGalleriesModal
        artifact={filingArtifact}
        onOpenChange={(open) => !open && setFilingArtifact(null)}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
