import type { Id } from "@musea/backend/convex/_generated/dataModel";
import { CommunityGalleryView } from "@/components/musea/community-gallery-view";

/** A public gallery, readable signed out. See the note in `community/page.tsx`. */
export default async function CommunityGalleryPage({
  params,
}: {
  params: Promise<{ galleryId: string }>;
}) {
  const { galleryId } = await params;

  return <CommunityGalleryView galleryId={galleryId as Id<"galleries">} />;
}
