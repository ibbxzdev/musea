"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, FolderPlus, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/musea/format";
import type { Artifact } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { CreateGalleryButton } from "./create-gallery";
import { EmptyState } from "./empty-state";
import { ResponsiveModal } from "./responsive-modal";

/**
 * "Add to gallery" — the checkbox sheet.
 *
 * Saves through `setGalleriesForArtifact`, which applies the whole selection as one
 * mutation. The alternative (an add per tick, a remove per untick) leaves the artifact
 * half-filed if the connection drops between two of them.
 */
export function FileIntoGalleriesModal({
  artifact,
  onOpenChange,
}: {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveModal
      open={artifact !== null}
      onOpenChange={onOpenChange}
      title="Add to gallery"
      description={artifact ? `Choose where “${artifact.title}” is filed.` : undefined}
    >
      {artifact && <FileIntoGalleriesForm artifact={artifact} onDone={() => onOpenChange(false)} />}
    </ResponsiveModal>
  );
}

function FileIntoGalleriesForm({ artifact, onDone }: { artifact: Artifact; onDone: () => void }) {
  const galleries = useQuery(api.galleries.listMine, {});
  const filedIn = useQuery(api.galleryArtifacts.listGalleriesForArtifact, {
    artifactId: artifact._id,
  });
  const setGalleries = useMutation(api.galleryArtifacts.setGalleriesForArtifact);

  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Seed the selection from the server exactly once, when it first arrives. Deriving it
  // on every render would undo a tick the moment the subscription re-ran.
  React.useEffect(() => {
    if (filedIn && selected === null) {
      setSelected(new Set(filedIn.map((gallery) => gallery._id)));
    }
  }, [filedIn, selected]);

  const toggle = (galleryId: string) => {
    setSelected((previous) => {
      const next = new Set(previous ?? []);
      if (next.has(galleryId)) next.delete(galleryId);
      else next.add(galleryId);
      return next;
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await setGalleries({
        artifactId: artifact._id,
        galleryIds: [...selected] as Id<"galleries">[],
      });
      onDone();
      toast.success("Filed");
    } catch {
      toast.error("Could not file that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const loading = galleries === undefined || selected === null;

  return (
    <div className="flex flex-col">
      <div className="max-h-[50dvh] overflow-y-auto px-5 pb-4 sm:px-6">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : galleries.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No galleries yet"
            description="Make one, then file this save into it."
            action={<CreateGalleryButton />}
            className="py-10"
          />
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border">
            {galleries.map((gallery) => {
              const checked = selected.has(gallery._id);

              return (
                <li key={gallery._id}>
                  <button
                    type="button"
                    onClick={() => toggle(gallery._id)}
                    aria-pressed={checked}
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border",
                        checked && "border-foreground bg-foreground text-background",
                      )}
                    >
                      {checked && <Check aria-hidden className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{gallery.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatCount(gallery.saveCount, "save")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="pb-safe sticky bottom-0 flex items-center gap-2 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
        <CreateGalleryButton className="shrink-0" />
        <Button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="h-11 flex-1 rounded-full"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Done"}
        </Button>
      </div>
    </div>
  );
}
