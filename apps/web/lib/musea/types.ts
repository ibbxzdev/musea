import type { api } from "@musea/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/**
 * Shapes for the Musea UI, derived from the Convex functions that produce them.
 *
 * Nothing here is hand-written. These used to be a parallel set of interfaces kept in
 * step with the backend by hand, which is a contract that holds right up until someone
 * renames a field — and then fails at runtime rather than at `tsc`. Reading them off the
 * function signatures means a backend change that breaks a card breaks the build.
 *
 * The backend already returns projections rather than raw documents (see
 * `convex/model/artifacts.ts`), so these are the presentation contract too: no
 * `searchText`, no `userId`, no storage ids.
 */

/** One save. `_id`, not `id` — these are Convex documents. */
export type Artifact = FunctionReturnType<typeof api.artifacts.search>[number];

/** A gallery as it appears in a grid: cover mosaic, save count, curator. */
export type GalleryCard = FunctionReturnType<typeof api.galleries.listMine>[number];

/** A gallery's own page. `null` when it is private and you are not its owner. */
export type GalleryDetail = NonNullable<FunctionReturnType<typeof api.galleries.get>>;

/** The signed-in curator. */
export type Viewer = NonNullable<FunctionReturnType<typeof api.users.viewer>>;

/** The three counts on the profile page. */
export type ViewerStats = FunctionReturnType<typeof api.users.stats>;

/** Where an artifact came from. Decided once at save time, never re-derived at render. */
export type SourceType = Artifact["sourceType"];

/** What an artifact *is*, which decides how its card renders. */
export type ArtifactKind = Artifact["kind"];

/** Enrichment state. `pending` and `failed` get a badge on the card. */
export type ArtifactStatus = Artifact["status"];

/** A curator, reduced to what a visitor is allowed to see. */
export type Curator = NonNullable<GalleryCard["owner"]>;
