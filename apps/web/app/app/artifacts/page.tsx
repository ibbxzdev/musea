import type { Metadata } from "next";
import { ArtifactsView } from "@/components/musea/artifacts-view";
import { RequireAuth } from "@/components/musea/require-auth";

export const metadata: Metadata = { title: "Artifacts" };

export default function ArtifactsPage() {
  return (
    <RequireAuth>
      <ArtifactsView />
    </RequireAuth>
  );
}
