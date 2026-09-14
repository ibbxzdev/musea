"use client";

import { api } from "@musea/backend/convex/_generated/api";
import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveModal } from "./responsive-modal";

/** Rename a gallery and rewrite its description. Visibility lives in the page's menu. */
export function EditGalleryModal({
  gallery,
  open,
  onOpenChange,
}: {
  gallery: { _id: Id<"galleries">; title: string; description?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateGallery = useMutation(api.galleries.update);

  const [title, setTitle] = React.useState(gallery.title);
  const [description, setDescription] = React.useState(gallery.description ?? "");
  const [saving, setSaving] = React.useState(false);

  // Re-seed the fields each time the sheet opens, so a cancelled edit does not persist
  // in component state and reappear the next time.
  React.useEffect(() => {
    if (open) {
      setTitle(gallery.title);
      setDescription(gallery.description ?? "");
    }
  }, [open, gallery.title, gallery.description]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      await updateGallery({ galleryId: gallery._id, title, description });
      onOpenChange(false);
      toast.success("Gallery updated");
    } catch {
      toast.error("Could not save those changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit gallery"
      description="Change what this collection is called and what it is about."
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="space-y-3 px-5 pb-4 sm:px-6">
          <div className="space-y-1.5">
            <Label htmlFor="edit-gallery-title">Name</Label>
            <Input
              id="edit-gallery-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-11"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-gallery-description">Description</Label>
            <Textarea
              id="edit-gallery-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional."
              className="min-h-24 resize-none"
            />
          </div>
        </div>

        <div className="pb-safe sticky bottom-0 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
          <Button
            type="submit"
            disabled={!title.trim() || saving}
            className="h-11 w-full rounded-full"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
