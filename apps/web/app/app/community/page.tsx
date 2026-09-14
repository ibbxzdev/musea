import type { Metadata } from "next";
import { CommunityView } from "@/components/musea/community-view";

export const metadata: Metadata = { title: "Community" };

/**
 * No `RequireAuth`: public galleries are readable signed out, so a shared link lands on
 * the gallery rather than on a sign-in form.
 */
export default function CommunityPage() {
  return <CommunityView />;
}
