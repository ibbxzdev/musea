"use client";

import { toast } from "sonner";

/**
 * Copying a link, with the one Safari rule that makes it work on a phone.
 *
 * **`navigator.clipboard.writeText` must be *called* inside the user gesture.** Safari
 * consumes user activation across an `await`, so awaiting anything before the call — a
 * query, a mutation, a URL you fetch — makes the write silently fail on iOS while working
 * fine in desktop Chrome. Every caller here passes a string it already has.
 *
 * The Clipboard API also needs a secure context, which is HTTPS everywhere and `localhost`.
 * That is already true of this app (see the WebAuthn notes in docs/architecture.md), so the missing-API
 * case is treated as a plain failure rather than given a `document.execCommand` fallback:
 * the deprecated path would only ever run somewhere the rest of the app is broken anyway.
 */
export async function copyLink(url: string, message: string, description?: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(message, description ? { description } : undefined);
  } catch {
    // Denied permission, an insecure context, or no API at all. Nothing here is
    // actionable by us, and the user can still select the link by hand.
    toast.error("Could not copy that link.");
  }
}

/**
 * An app path as a link someone else can open.
 *
 * Built from `window.location.origin` rather than a configured site URL, for the same
 * reason the auth client resolves its base that way: the origin is correct on localhost,
 * on previews and in production, and cannot go stale in a build.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}
