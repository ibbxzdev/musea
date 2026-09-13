"use client";

import { ArrowDownUp, SearchX, Sparkles } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ARTIFACTS } from "@/lib/musea/fixtures";
import { KIND_FILTERS, KIND_LABELS } from "@/lib/musea/sources";
import type { Artifact, ArtifactKind } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { ArtifactGrid } from "./artifact-grid";
import { EmptyState } from "./empty-state";

type SortDir = "newest" | "oldest";

/** Title, summary and tags — the same fields the app's vector search covers. */
function matchesQuery(artifact: Artifact, query: string) {
  if (!query) return true;
  const haystack = [artifact.title, artifact.description ?? "", ...artifact.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function ArtifactsPanel({
  query,
  onOpenArtifact,
}: {
  query: string;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const [kind, setKind] = React.useState<ArtifactKind | "all">("all");
  const [sort, setSort] = React.useState<SortDir>("newest");

  const normalisedQuery = query.trim().toLowerCase();

  const artifacts = React.useMemo(() => {
    return ARTIFACTS.filter(
      (artifact) =>
        (kind === "all" || artifact.kind === kind) && matchesQuery(artifact, normalisedQuery),
    ).sort((a, b) => {
      const delta = new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
      return sort === "newest" ? delta : -delta;
    });
  }, [kind, normalisedQuery, sort]);

  return (
    <div>
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
            <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full">
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
              <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">Oldest first</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {artifacts.length > 0 ? (
        <ArtifactGrid artifacts={artifacts} onOpen={onOpenArtifact} />
      ) : normalisedQuery ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          description="Try different words — search looks at titles, summaries and tags."
        />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Nothing here yet"
          description="Save a link, an image or a note and Musea files it for you."
        />
      )}
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
