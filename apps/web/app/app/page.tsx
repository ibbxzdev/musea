import type { Metadata } from "next";
import { MuseaApp } from "@/components/musea/musea-app";

export const metadata: Metadata = {
  title: "Musea",
  description: "Your artifacts, galleries and the community — a visual library for what you keep.",
};

/**
 * The Musea browse UI, ported from the iOS app.
 *
 * Presentation only: everything renders from `lib/musea/fixtures.ts`, nothing talks to
 * Convex, and no tipping affordance appears here. The scaffold's build-status page at
 * `/` is left alone deliberately — see the note at the top of `app/page.tsx`.
 */
export default function MuseaPage() {
  return <MuseaApp />;
}
