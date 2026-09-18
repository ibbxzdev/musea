import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { searchTextFor } from "./model/artifacts";
import type { Id } from "./_generated/dataModel";

/**
 * Demo galleries (Story 0.4).
 *
 * Re-runnable by design: the recovery path after a testnet reset is this plus
 * `scripts/setup-testnet.sh`, and a seed that duplicates on the second run is worse than
 * no seed at all. Everything below is upserted on a natural key rather than inserted.
 *
 * ── Why `ownerHandle` and not synthetic demo users ────────────────────────────────────
 * A user row invented here would carry an `authSubject` nobody can ever sign in as, so
 * its galleries could never be tipped in the recorded demo — the tipper has to be a real
 * session and the curator has to be a real account for the receipt to mean anything.
 *
 * So the real demo path is: sign up both accounts in the app, then run
 *
 *     npx convex run seed:run '{"ownerHandle":"<the curator handle>"}'
 *
 * and the galleries attach to that real user. The placeholder owner is a local-dev
 * convenience only.
 *
 * Note what is deliberately absent: nothing here lets a caller supply `authSubject`. This
 * is an internalMutation, so it is not client-reachable at all, but a seed that could mint
 * an arbitrary identity would be a worse hole than the one docs/architecture.md's rule 2 closes.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

const PLACEHOLDER_CURATOR = {
  authSubject: "seed:placeholder-curator",
  name: "Ada Placeholder",
  handle: "placeholder",
} as const;

/** Two galleries, a handful of items each. Titles are the idempotency key. */
const GALLERIES = [
  {
    title: "Concrete and Light",
    description:
      "Brutalist interiors photographed on overcast mornings, when the concrete stops being grey.",
    coverImageUrl: "https://images.unsplash.com/photo-1470723710355-95304d8aece4?w=1200",
    items: [
      {
        kind: "image" as const,
        title: "Barbican, stairwell",
        imageUrl: "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200",
      },
      {
        kind: "note" as const,
        title: "Peter Zumthor",
        text: "I believe that architecture today needs to reflect on the tasks and possibilities which are inherently its own.",
      },
      {
        kind: "link" as const,
        title: "The Barbican Estate",
        url: "https://www.barbican.org.uk/our-story/our-building",
      },
    ],
  },
  {
    title: "Field Recordings",
    description: "Places that sounded better than they looked. Collected over four years.",
    coverImageUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200",
    items: [
      {
        kind: "link" as const,
        title: "Radio Aporee — maps",
        url: "https://aporee.org/maps/",
      },
      {
        kind: "note" as const,
        title: "Pauline Oliveros",
        text: "Listening is not the same as hearing, and hearing is not the same as listening.",
      },
      {
        kind: "image" as const,
        title: "Tape machine, Lisbon",
        imageUrl: "https://images.unsplash.com/photo-1511735111819-9a3f7709049c?w=1200",
      },
    ],
  },
] as const;

export const run = internalMutation({
  args: {
    /**
     * Handle of an existing, real user to own the demo galleries — the curator you
     * intend to record the demo with. Omit only for local dev.
     */
    ownerHandle: v.optional(v.string()),
  },
  handler: async (ctx, { ownerHandle }) => {
    const ownerId = await resolveOwner(ctx, ownerHandle);

    const galleryIds: Id<"galleries">[] = [];
    let galleriesCreated = 0;
    let itemsCreated = 0;

    for (const spec of GALLERIES) {
      const existing = await ctx.db
        .query("galleries")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .filter((q) => q.eq(q.field("title"), spec.title))
        .first();

      const galleryId =
        existing?._id ??
        (await ctx.db.insert("galleries", {
          ownerId,
          title: spec.title,
          description: spec.description,
          coverImageUrl: spec.coverImageUrl,
          // Demo galleries exist to be browsed and tipped by someone who is not the
          // owner, which is exactly what `isPublic` gates.
          isPublic: true,
          createdAt: Date.now(),
        }));
      if (!existing) galleriesCreated++;
      else if (!existing.isPublic) {
        /**
         * A gallery seeded before `isPublic` existed reads as private, which keeps it out
         * of Community and therefore out of the tipping demo entirely. Upserting on the
         * title has to mean the visibility too, or re-running the seed silently leaves the
         * one property the demo depends on unset.
         */
        await ctx.db.patch(galleryId, { isPublic: true });
      }
      galleryIds.push(galleryId);

      // Items are re-seeded only into an empty gallery. Matching item-by-item would let a
      // hand-edited demo gallery silently grow a duplicate on every run.
      const filed = await ctx.db
        .query("galleryArtifacts")
        .withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
        .collect();
      if (filed.length > 0) continue;

      for (const item of spec.items) {
        const createdAt = Date.now();
        const title = item.title;
        const description = "text" in item ? item.text : undefined;

        /**
         * Seeded artifacts go in `ready` with no `source`, so nothing schedules a scrape
         * for them. A seed that fired `linkPreview.enrichArtifact` would rewrite these
         * titles from whatever the linked page says today, and the demo would read
         * differently every time it is re-run.
         */
        const artifactId = await ctx.db.insert("artifacts", {
          userId: ownerId,
          kind: item.kind,
          title,
          description,
          imageUrl: "imageUrl" in item ? item.imageUrl : undefined,
          source: "url" in item ? item.url : undefined,
          /**
           * Three kinds, three origins. A seeded picture has no URL behind it, so calling
           * it a "link" would put a Link chip on a card that goes nowhere — `files` is
           * what the app uses for a picture that came from no particular platform.
           */
          sourceType: item.kind === "note" ? "note" : item.kind === "image" ? "files" : "link",
          tags: [],
          status: "ready",
          searchText: searchTextFor({ title, description }),
          createdAt,
        });

        await ctx.db.insert("galleryArtifacts", {
          galleryId,
          artifactId,
          userId: ownerId,
          createdAt,
        });
        itemsCreated++;
      }
    }

    return { ownerId, galleryIds, galleriesCreated, itemsCreated };
  },
});

async function resolveOwner(
  ctx: MutationCtx,
  ownerHandle: string | undefined,
): Promise<Id<"users">> {
  if (ownerHandle) {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", ownerHandle))
      .unique();
    if (owner) return owner._id;

    // Fail loudly rather than quietly seeding onto a placeholder. Silently attaching the
    // demo galleries to an account nobody can sign into is exactly the kind of thing that
    // is only noticed while recording.
    const available = (await ctx.db.query("users").take(20)).map((u) => u.handle);
    throw new Error(
      `No user with handle "${ownerHandle}". Sign that account up first. ` +
        `Existing handles: ${available.length ? available.join(", ") : "(none)"}.`,
    );
  }

  const placeholder = await ctx.db
    .query("users")
    .withIndex("by_authSubject", (q) => q.eq("authSubject", PLACEHOLDER_CURATOR.authSubject))
    .unique();
  if (placeholder) return placeholder._id;

  return await ctx.db.insert("users", { ...PLACEHOLDER_CURATOR, createdAt: Date.now() });
}
