import type { Metadata } from "next";
import { ActivityView } from "@/components/musea/activity-view";
import { RequireAuth } from "@/components/musea/require-auth";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <RequireAuth>
      <ActivityView />
    </RequireAuth>
  );
}
