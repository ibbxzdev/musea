"use client";

import { ArrowLeft, ImagePlus, Loader2, NotebookPen, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "./responsive-modal";

/** Long enough to read as "fetching", short enough not to feel broken. */
const PREVIEW_DELAY_MS = 600;
/** Matches the native app: a few keystrokes of prose, then it becomes a note. */
const NOTE_DEBOUNCE_MS = 500;

type AddMode = "idle" | "url" | "note" | "media";

type LinkPreview = { host: string; title: string; description: string };

type PickedMedia = { objectUrl: string; name: string; isVideo: boolean };

function looksLikeUrl(value: string) {
  return /^https?:\/\/.+\..+/i.test(value.trim());
}

/** True while a URL is still being typed, so prose-detection does not fire on "htt". */
function looksLikeUrlPrefix(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return "https://".startsWith(trimmed) || "http://".startsWith(trimmed);
}

/**
 * Stands in for the `preview.getPreview` Convex action.
 *
 * The real one scrapes Open Graph tags server-side. This one reads the host out of the
 * URL so the preview card has something true in it, and is clearly labelled below as
 * not-yet-fetched rather than pretending to have loaded a page.
 */
function synthesisePreview(url: string): LinkPreview {
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    // An unparseable string never reaches here — looksLikeUrl gates the call.
  }
  return {
    host,
    title: host,
    description: "Musea will read this page and write a title, summary and tags for it.",
  };
}

export function AddArtifactModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Save to Musea"
      description="Paste a link, write a note, or pick something from your library."
    >
      <AddArtifactForm onDone={() => onOpenChange(false)} />
    </ResponsiveModal>
  );
}

function AddArtifactForm({ onDone }: { onDone: () => void }) {
  const [input, setInput] = React.useState("");
  const [noteTitle, setNoteTitle] = React.useState("");
  const [noteBody, setNoteBody] = React.useState("");
  const [noteActive, setNoteActive] = React.useState(false);
  const [media, setMedia] = React.useState<PickedMedia | null>(null);
  const [preview, setPreview] = React.useState<LinkPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const mode: AddMode = media
    ? "media"
    : noteActive
      ? "note"
      : looksLikeUrl(input)
        ? "url"
        : "idle";

  // Typing prose rather than a URL turns the field into a note and carries the text over.
  React.useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed || looksLikeUrl(trimmed) || looksLikeUrlPrefix(trimmed)) return;

    const timer = setTimeout(() => {
      setNoteBody(trimmed);
      setNoteActive(true);
      setInput("");
    }, NOTE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input]);

  // Debounced "fetch" of the link preview.
  React.useEffect(() => {
    const trimmed = input.trim();
    if (!looksLikeUrl(trimmed)) {
      setPreview(null);
      setLoadingPreview(false);
      return;
    }

    setLoadingPreview(true);
    const timer = setTimeout(() => {
      setPreview(synthesisePreview(trimmed));
      setLoadingPreview(false);
    }, PREVIEW_DELAY_MS);

    return () => clearTimeout(timer);
  }, [input]);

  // Object URLs are held by the browser until they are revoked, so tie one to the pick
  // that created it and let it go as soon as that pick is replaced or the sheet closes.
  React.useEffect(() => {
    if (!media) return;
    return () => URL.revokeObjectURL(media.objectUrl);
  }, [media]);

  const reset = () => {
    setInput("");
    setNoteTitle("");
    setNoteBody("");
    setNoteActive(false);
    setMedia(null);
    setPreview(null);
  };

  const handlePickMedia = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be picked twice in a row — without this the input keeps its value
    // and fires no change event the second time.
    event.target.value = "";
    if (!file) return;

    setInput("");
    setMedia({
      objectUrl: URL.createObjectURL(file),
      name: file.name,
      isVideo: file.type.startsWith("video/"),
    });
  };

  const canSave =
    mode === "media" ||
    (mode === "note" && (noteBody.trim().length > 0 || noteTitle.trim().length > 0)) ||
    (mode === "url" && input.trim().length > 0);

  const handleSave = () => {
    setSaving(true);
    // Story 3.x replaces this with the `artifacts.createArtifact` mutation. Until then it
    // is honest about being a mock rather than quietly pretending to have saved.
    setTimeout(() => {
      setSaving(false);
      reset();
      onDone();
      toast.success("Saved to Musea", { description: "Not yet persisted — UI preview only." });
    }, 400);
  };

  return (
    <div className="flex flex-col">
      <div className="px-5 pb-4 sm:px-6">
        {mode === "idle" && (
          <QuickActions
            onPickMedia={() => fileInputRef.current?.click()}
            onStartNote={() => setNoteActive(true)}
          />
        )}

        {mode === "url" && <UrlPreviewCard loading={loadingPreview} preview={preview} />}

        {mode === "note" && (
          <NoteEditor
            title={noteTitle}
            body={noteBody}
            onTitleChange={setNoteTitle}
            onBodyChange={setNoteBody}
          />
        )}

        {mode === "media" && media && <MediaPreview media={media} />}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handlePickMedia}
        className="sr-only"
        tabIndex={-1}
      />

      <SaveBar
        mode={mode}
        input={input}
        onInputChange={setInput}
        onBack={reset}
        onSave={handleSave}
        saving={saving}
        disabled={!canSave || saving}
      />
    </div>
  );
}

function QuickActions({
  onPickMedia,
  onStartNote,
}: {
  onPickMedia: () => void;
  onStartNote: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <QuickAction icon={ImagePlus} label="Media" onClick={onPickMedia} />
      <QuickAction icon={NotebookPen} label="Note" onClick={onStartNote} />
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ImagePlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-base font-medium transition-[background-color,transform] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
    >
      <Icon aria-hidden className="size-7" />
      {label}
    </button>
  );
}

function UrlPreviewCard({ loading, preview }: { loading: boolean; preview: LinkPreview | null }) {
  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-32 w-full animate-pulse rounded-2xl bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="rounded-2xl border p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {preview.host}
      </p>
      <p className="mt-1 text-base font-semibold tracking-tight">{preview.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{preview.description}</p>
    </div>
  );
}

function NoteEditor({
  title,
  body,
  onTitleChange,
  onBodyChange,
}: {
  title: string;
  body: string;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="musea-note-title">Title</Label>
        <Input
          id="musea-note-title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Optional"
          className="h-11"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="musea-note-body">Note</Label>
        <Textarea
          id="musea-note-body"
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder="Write something worth keeping."
          className="min-h-36 resize-none"
        />
      </div>
    </div>
  );
}

function MediaPreview({ media }: { media: PickedMedia }) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl bg-muted">
        {media.isVideo ? (
          // No caption track: this is the user's own file, not yet uploaded anywhere.
          <video src={media.objectUrl} controls playsInline className="max-h-72 w-full" />
        ) : (
          // A plain <img>, not next/image: the src is a blob: URL from the file picker,
          // which the image optimiser cannot fetch — and there is nothing to optimise.
          // biome-ignore lint/performance/noImgElement: local blob preview, never remote
          <img src={media.objectUrl} alt={media.name} className="max-h-72 w-full object-contain" />
        )}
      </div>
      <p className="truncate text-sm text-muted-foreground">{media.name}</p>
    </div>
  );
}

/**
 * The bottom bar: back out of the current mode, or type, and save.
 *
 * `pb-safe` keeps it clear of the iPhone home indicator, and it is pinned so the Save
 * button stays where the thumb expects it regardless of how tall the sheet content is.
 */
function SaveBar({
  mode,
  input,
  onInputChange,
  onBack,
  onSave,
  saving,
  disabled,
}: {
  mode: AddMode;
  input: string;
  onInputChange: (value: string) => void;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  const showInput = mode === "idle" || mode === "url";

  return (
    <div className="pb-safe sticky bottom-0 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        {!showInput && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onBack}
            className="size-11 shrink-0 rounded-full"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Start over</span>
          </Button>
        )}

        {showInput && (
          <div className="relative flex-1">
            <Input
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="Paste a link or start typing"
              aria-label="Paste a link or start typing"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 rounded-full border-transparent bg-muted pr-11 shadow-none focus-visible:border-transparent dark:bg-muted"
            />
            {input.length > 0 && (
              <button
                type="button"
                onClick={() => onInputChange("")}
                className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
                <span className="sr-only">Clear</span>
              </button>
            )}
          </div>
        )}

        <Button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className={cn("h-11 rounded-full px-6", !showInput && "flex-1")}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
