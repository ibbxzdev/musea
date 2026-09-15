"use client";

import { Copy } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

/**
 * The raw failure, on screen — temporary, for the first real-device pass.
 *
 * A toast saying "Something went wrong" is the right thing to show a user and the wrong
 * thing to debug from, and on an iPhone there is no console to fall back to. This renders
 * what actually failed, in place, with a copy button — because the realistic way this text
 * gets to anyone who can act on it is someone pasting it into a message.
 *
 * Collapsed by default so it does not dominate the card it is attached to. Remove this
 * component, and its call sites, once the device pass is done.
 */
export function ErrorDetail({ detail }: { detail: string | null }) {
  const [open, setOpen] = React.useState(false);

  if (!detail) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      toast.success("Copied");
    } catch {
      // `navigator.clipboard` needs a secure context and rejects silently in some iOS
      // configurations. Expanding the panel at least leaves the text selectable by hand.
      setOpen(true);
      toast.error("Couldn't copy — select the text instead.");
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-left text-xs font-medium text-destructive underline underline-offset-4"
        >
          {open ? "Hide" : "Show"} error details
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy error details"
          className="tap-target inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Copy className="size-3" />
          Copy
        </button>
      </div>

      {open ? (
        // `break-all` rather than `break-words`: most of what lands here is one
        // unbreakable token — a contract address, a base64 blob, an XDR fragment — and
        // without it the panel scrolls sideways off a 390px screen.
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
