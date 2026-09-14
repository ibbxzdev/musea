import type { Metadata } from "next";
import { GalleriesView } from "@/components/musea/galleries-view";
import { RequireAuth } from "@/components/musea/require-auth";

export const metadata: Metadata = { title: "Galleries" };

export default function GalleriesPage() {
  return (
    <RequireAuth>
      <GalleriesView />
    </RequireAuth>
  );
}
