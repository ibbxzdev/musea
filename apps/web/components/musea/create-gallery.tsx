"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "./responsive-modal";

/** The "New gallery" button and the sheet it opens. */
export function CreateGalleryButton({
  className,
  variant = "secondary",
  label = "New gallery",
}: {
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={() => setOpen(true)}
        className={cn("h-11 rounded-full px-5", className)}
      >
        <Plus className="size-4" />
        {label}
      </Button>
      <CreateGalleryModal open={open} onOpenChange={setOpen} />
    </>
  );
}

function CreateGalleryModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createGallery = useMutation(api.galleries.create);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      await createGallery({ title, description: description || undefined, isPublic });
      setTitle("");
      setDescription("");
      setIsPublic(false);
      onOpenChange(false);
      toast.success("Gallery created");
    } catch {
      toast.error("Could not create that gallery.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="New gallery"
      description="Galleries are how a library becomes a collection."
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="space-y-3 px-5 pb-4 sm:px-6">
          <div className="space-y-1.5">
            <Label htmlFor="gallery-title">Name</Label>
            <Input
              id="gallery-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Concrete and Light"
              className="h-11"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gallery-description">Description</Label>
            <Textarea
              id="gallery-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional. What ties these together?"
              className="min-h-24 resize-none"
            />
          </div>

          {/*
            A switch row rather than a checkbox: this is the one control on the sheet that
            changes who can see the contents, and it deserves to read as a decision.
          */}
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            onClick={() => setIsPublic((previous) => !previous)}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Public</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Anyone can open this gallery, see what is filed in it, and tip you for it.
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                isPublic ? "bg-foreground" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-background transition-[left]",
                  isPublic ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </span>
          </button>
        </div>

        <div className="pb-safe sticky bottom-0 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
          <Button
            type="submit"
            disabled={!title.trim() || saving}
            className="h-11 w-full rounded-full"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Create gallery"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
