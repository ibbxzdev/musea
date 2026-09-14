import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { GalleryDetailView } from "@/components/musea/gallery-detail-view";
import { RequireAuth } from "@/components/musea/require-auth";

/**
 * One of your galleries, at its own URL.
 *
 * The id arrives as a plain string from the route and is cast to `Id<"galleries">` here.
 * That cast is not a trust decision: a string that is not a real id fails validation at
 * the Convex boundary, and one that is a real id belonging to someone else resolves to
 * `null` in `galleries.get`. Both land on the same "not found" state.
 */
export default async function GalleryPage({ params }: { params: Promise<{ galleryId: string }> }) {
  const { galleryId } = await params;

  return (
    <RequireAuth>
      <GalleryDetailView galleryId={galleryId as Id<"galleries">} />
    </RequireAuth>
  );
}
