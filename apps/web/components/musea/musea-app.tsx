"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { Artifact } from "@/lib/musea/types";
import { AddArtifactModal } from "./add-artifact";
import { ArtifactDetail } from "./artifact-detail";
import { ArtifactsPanel } from "./artifacts-panel";
import { CommunityPanel } from "./community-panel";
import { GalleriesPanel } from "./galleries-panel";
import { ProfilePanel } from "./profile-panel";
import { SearchField } from "./search-field";

const TABS = [
  { value: "artifacts", label: "Artifacts", searchPlaceholder: "Search anything" },
  { value: "galleries", label: "Galleries", searchPlaceholder: "Search galleries" },
  { value: "community", label: "Community", searchPlaceholder: "Search curators" },
  { value: "profile", label: "Profile", searchPlaceholder: null },
] as const;

type TabValue = (typeof TABS)[number]["value"];

const EMPTY_QUERIES: Record<TabValue, string> = {
  artifacts: "",
  galleries: "",
  community: "",
  profile: "",
};

export function MuseaApp() {
  const [tab, setTab] = React.useState<TabValue>("artifacts");
  const [openArtifact, setOpenArtifact] = React.useState<Artifact | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  /**
   * One query box, but each tab searches its own things. Keyed by tab so switching does
   * not carry a half-typed curator name into a search over your own saves.
   */
  const [queries, setQueries] = React.useState(EMPTY_QUERIES);

  /**
   * Which gallery each browse tab is drilled into.
   *
   * Held here rather than inside the panels because Radix unmounts an inactive tab: a
   * panel that owned this state would forget where you were the moment you looked at
   * another tab, and a tab on iOS is supposed to keep its own navigation stack.
   */
  const [openGalleryId, setOpenGalleryId] = React.useState<string | null>(null);
  const [openCommunityId, setOpenCommunityId] = React.useState<string | null>(null);

  const isDesktop = useIsDesktop();
  const activeTab = TABS.find((entry) => entry.value === tab) ?? TABS[0];

  const setQuery = (value: string) => setQueries((previous) => ({ ...previous, [tab]: value }));

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as TabValue)}
      // The rail goes vertical from lg up, where there is a gutter to put it in. Below
      // that a 10rem rail would eat a quarter of a 390px screen.
      orientation={isDesktop ? "vertical" : "horizontal"}
      // Forced: a vertical Tabs root lays itself out as a row, which would put the header
      // beside the content instead of above it.
      className="flex-col gap-0"
    >
      <header className="pt-safe sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-6xl px-5">
          <div className="flex items-center justify-between gap-3 pb-3">
            {/* iOS large title: 34px, bold, tight. */}
            <h1 className="text-[34px] leading-none font-bold tracking-tight">Musea</h1>
            <Button
              onClick={() => setAddOpen(true)}
              size="icon"
              className="size-11 shrink-0 rounded-full"
            >
              <Plus className="size-5" />
              <span className="sr-only">Save to Musea</span>
            </Button>
          </div>

          {activeTab.searchPlaceholder && (
            <SearchField
              value={queries[tab]}
              onValueChange={setQuery}
              placeholder={activeTab.searchPlaceholder}
              className="max-w-md pb-3"
            />
          )}

          {/* Below lg the rail lives in the header, under the search field. */}
          {!isDesktop && (
            <MuseaTabsList className="w-full justify-start gap-4 overflow-x-auto pb-2 scrollbar-none" />
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-10 px-5 pt-5 pb-16">
        {isDesktop && (
          // top-36 clears the sticky header (large title + search ≈ 8rem) with a little
          // air. Anything smaller and the rail slides under the blur.
          <MuseaTabsList className="sticky top-36 h-fit w-fit shrink-0 self-start" />
        )}

        <div className="min-w-0 flex-1">
          <TabsContent value="artifacts">
            <ArtifactsPanel query={queries.artifacts} onOpenArtifact={setOpenArtifact} />
          </TabsContent>
          <TabsContent value="galleries">
            <GalleriesPanel
              query={queries.galleries}
              openGalleryId={openGalleryId}
              onOpenGallery={setOpenGalleryId}
              onOpenArtifact={setOpenArtifact}
            />
          </TabsContent>
          <TabsContent value="community">
            <CommunityPanel
              query={queries.community}
              openGalleryId={openCommunityId}
              onOpenGallery={setOpenCommunityId}
              onOpenArtifact={setOpenArtifact}
            />
          </TabsContent>
          <TabsContent value="profile">
            <ProfilePanel />
          </TabsContent>
        </div>
      </div>

      <ArtifactDetail
        artifact={openArtifact}
        onOpenChange={(open) => !open && setOpenArtifact(null)}
      />
      <AddArtifactModal open={addOpen} onOpenChange={setAddOpen} />
    </Tabs>
  );
}

function MuseaTabsList({ className }: { className?: string }) {
  return (
    <TabsList variant="line" className={className}>
      {TABS.map((entry) => (
        <TabsTrigger key={entry.value} value={entry.value} className="flex-none">
          {entry.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
