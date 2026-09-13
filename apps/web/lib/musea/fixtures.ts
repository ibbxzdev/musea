import type { Artifact, CommunityGallery, Gallery, Profile } from "./types";

/**
 * Fixture data for the browse UI.
 *
 * Nothing here is wired to Convex yet — this file is the seam. When Story 3.x lands these
 * exports get replaced by `useQuery` calls returning the same shapes, and nothing under
 * `components/musea/` has to change.
 *
 * Thumbnails come from picsum.photos by seed, so the same id always yields the same
 * picture and the grid looks identical on every reload.
 */
const thumb = (seed: string, width: number, height: number) =>
  `https://picsum.photos/seed/${seed}/${width}/${height}`;

export const ARTIFACTS: Artifact[] = [
  {
    id: "a1",
    kind: "image",
    title: "Brutalist stairwell, Lisbon",
    description:
      "Concrete cast in place, board-marked, then left alone for forty years. The handrail is the only thing anyone has touched since.",
    tags: ["architecture", "concrete", "lisbon"],
    imageUrl: thumb("musea-a1", 600, 800),
    aspectRatio: 0.75,
    source: "https://www.pinterest.com/pin/brutalist-stairwell",
    sourceType: "pinterest",
    savedAt: "2026-09-10T09:12:00.000Z",
    galleryIds: ["g1", "g4"],
    status: "ready",
  },
  {
    id: "a2",
    kind: "note",
    title: "On shipping",
    description:
      "The best products do not just solve problems — they make people feel something. Ship the feeling first and the feature list will follow.",
    tags: ["product", "writing"],
    sourceType: "note",
    savedAt: "2026-09-09T18:40:00.000Z",
    galleryIds: ["g2"],
    status: "ready",
  },
  {
    id: "a3",
    kind: "video",
    title: "How attention mechanisms actually work",
    description:
      "A visual walk through transformers from scratch — query, key and value built up one matrix at a time, no hand-waving.",
    tags: ["ai", "learning", "transformers"],
    imageUrl: thumb("musea-a3", 600, 400),
    aspectRatio: 1.5,
    source: "https://www.youtube.com/watch?v=attention",
    sourceType: "youtube",
    savedAt: "2026-09-08T11:05:00.000Z",
    galleryIds: ["g3"],
    status: "ready",
  },
  {
    id: "a4",
    kind: "image",
    title: "Risograph colour tests",
    tags: ["print", "colour"],
    imageUrl: thumb("musea-a4", 600, 620),
    aspectRatio: 0.97,
    sourceType: "gallery",
    savedAt: "2026-09-07T15:22:00.000Z",
    galleryIds: ["g4"],
    status: "ready",
  },
  {
    id: "a5",
    kind: "link",
    title: "The unreasonable effectiveness of just shipping",
    description:
      "Why launching beats planning every time, and how to get comfortable with imperfect.",
    tags: ["startups", "productivity"],
    imageUrl: thumb("musea-a5", 600, 340),
    aspectRatio: 1.76,
    source: "https://medium.com/@builder/just-shipping",
    sourceType: "link",
    savedAt: "2026-09-06T08:00:00.000Z",
    galleryIds: ["g2"],
    status: "ready",
  },
  {
    id: "a6",
    kind: "image",
    title: "Kitchen light study",
    tags: ["photography", "light"],
    imageUrl: thumb("musea-a6", 600, 900),
    aspectRatio: 0.67,
    source: "https://www.instagram.com/p/kitchen-light",
    sourceType: "instagram",
    savedAt: "2026-09-05T20:31:00.000Z",
    galleryIds: ["g1"],
    status: "ready",
  },
  {
    id: "a7",
    kind: "note",
    title: "Interface debt",
    description:
      "Every inconsistent control is a small tax on attention. You never get a bill; you just notice people stop using the thing.",
    tags: ["design", "systems"],
    sourceType: "note",
    savedAt: "2026-09-04T12:45:00.000Z",
    galleryIds: ["g2", "g5"],
    status: "ready",
  },
  {
    id: "a8",
    kind: "image",
    title: "Tokyo signage at night",
    tags: ["typography", "tokyo", "neon"],
    imageUrl: thumb("musea-a8", 600, 780),
    aspectRatio: 0.77,
    source: "https://www.reddit.com/r/CityPorn/tokyo-signage",
    sourceType: "reddit",
    savedAt: "2026-09-03T22:10:00.000Z",
    galleryIds: ["g5"],
    status: "ready",
  },
  {
    id: "a9",
    kind: "image",
    title: "Swiss railway timetable, 1972",
    description: "Still the clearest information design anyone has printed on paper.",
    tags: ["typography", "grid", "swiss"],
    imageUrl: thumb("musea-a9", 600, 460),
    aspectRatio: 1.3,
    sourceType: "files",
    savedAt: "2026-08-30T09:00:00.000Z",
    galleryIds: ["g5"],
    status: "ready",
  },
  {
    id: "a10",
    kind: "video",
    title: "Making a chair with no fasteners",
    tags: ["woodworking", "craft"],
    imageUrl: thumb("musea-a10", 600, 1000),
    aspectRatio: 0.6,
    source: "https://www.tiktok.com/@joiner/video/chair",
    sourceType: "tiktok",
    savedAt: "2026-08-28T17:25:00.000Z",
    galleryIds: ["g4"],
    status: "ready",
  },
  {
    id: "a11",
    kind: "image",
    title: "Coastal fog, half past six",
    tags: ["photography", "weather"],
    imageUrl: thumb("musea-a11", 600, 400),
    aspectRatio: 1.5,
    sourceType: "gallery",
    savedAt: "2026-08-26T06:30:00.000Z",
    galleryIds: ["g1"],
    status: "ready",
  },
  {
    id: "a12",
    kind: "link",
    title: "A short history of the bottom sheet",
    description:
      "From ActionSheet to the modern detent — why the same control arrived on every platform within eighteen months.",
    tags: ["design", "mobile", "history"],
    imageUrl: thumb("musea-a12", 600, 600),
    aspectRatio: 1,
    source: "https://x.com/uiarchive/status/bottom-sheet",
    sourceType: "x",
    savedAt: "2026-08-22T13:15:00.000Z",
    galleryIds: ["g5"],
    status: "ready",
  },
  {
    id: "a13",
    kind: "image",
    title: "Terrazzo samples, warm greys",
    tags: ["material", "interior"],
    imageUrl: thumb("musea-a13", 600, 700),
    aspectRatio: 0.86,
    source: "https://www.pinterest.com/pin/terrazzo-warm-greys",
    sourceType: "pinterest",
    savedAt: "2026-08-19T10:05:00.000Z",
    galleryIds: ["g4"],
    status: "pending",
  },
  {
    id: "a14",
    kind: "note",
    title: "Reading list, autumn",
    description:
      "Seeing Like a State · The Design of Everyday Things (again) · Ways of Seeing · anything by Ursula Franklin.",
    tags: ["reading"],
    sourceType: "note",
    savedAt: "2026-08-15T19:00:00.000Z",
    galleryIds: ["g3"],
    status: "ready",
  },
  {
    id: "a15",
    kind: "image",
    title: "Studio wall, week eleven",
    tags: ["process", "studio"],
    imageUrl: thumb("musea-a15", 600, 840),
    aspectRatio: 0.71,
    sourceType: "gallery",
    savedAt: "2026-08-11T16:20:00.000Z",
    galleryIds: [],
    status: "ready",
  },
  {
    id: "a16",
    kind: "link",
    title: "Why your grid breaks at 390px",
    tags: ["css", "responsive"],
    imageUrl: thumb("musea-a16", 600, 380),
    aspectRatio: 1.58,
    source: "https://example.com/grid-390",
    sourceType: "link",
    savedAt: "2026-08-04T11:40:00.000Z",
    galleryIds: ["g5"],
    status: "failed",
  },
  {
    id: "a17",
    kind: "image",
    title: "Ceramics, unglazed",
    tags: ["ceramics", "craft"],
    imageUrl: thumb("musea-a17", 600, 760),
    aspectRatio: 0.79,
    source: "https://www.instagram.com/p/unglazed",
    sourceType: "instagram",
    savedAt: "2026-07-29T08:55:00.000Z",
    galleryIds: ["g4"],
    status: "ready",
  },
  {
    id: "a18",
    kind: "image",
    title: "Mountain hut, early season",
    tags: ["travel", "architecture"],
    imageUrl: thumb("musea-a18", 600, 520),
    aspectRatio: 1.15,
    sourceType: "files",
    savedAt: "2026-07-21T07:15:00.000Z",
    galleryIds: ["g1"],
    status: "ready",
  },
];

export const GALLERIES: Gallery[] = [
  {
    id: "g1",
    title: "Light & Weather",
    description: "Pictures that are really about the air in the room.",
    isAuto: false,
    artifactIds: ["a1", "a6", "a11", "a18"],
  },
  {
    id: "g2",
    title: "Things Worth Re-reading",
    isAuto: false,
    artifactIds: ["a2", "a5", "a7"],
  },
  {
    id: "g3",
    title: "Learning",
    description: "Filed here automatically.",
    isAuto: true,
    artifactIds: ["a3", "a14"],
  },
  {
    id: "g4",
    title: "Made by Hand",
    isAuto: false,
    artifactIds: ["a1", "a4", "a10", "a13", "a17"],
  },
  {
    id: "g5",
    title: "Type & Interface",
    description: "Signage, timetables, controls.",
    isAuto: true,
    artifactIds: ["a7", "a8", "a9", "a12", "a16"],
  },
  {
    id: "g6",
    title: "Someday",
    description: "Nothing filed here yet.",
    isAuto: false,
    artifactIds: [],
  },
];

export const COMMUNITY_GALLERIES: CommunityGallery[] = [
  {
    id: "c1",
    title: "Concrete Poetry",
    description: "Twelve years of photographing post-war civic buildings.",
    curator: { name: "Noor Haddad", handle: "noor" },
    saveCount: 284,
    followerCount: 1920,
  },
  {
    id: "c2",
    title: "Everything Is a Remix",
    description: "Source material, side by side with what it became.",
    curator: { name: "Theo Marchetti", handle: "theo" },
    saveCount: 96,
    followerCount: 640,
  },
  {
    id: "c3",
    title: "Field Notes: Kyoto",
    description: "Two weeks of looking at doorways.",
    curator: { name: "Rin Watanabe", handle: "rin" },
    saveCount: 51,
    followerCount: 412,
  },
  {
    id: "c4",
    title: "Interfaces That Aged Well",
    description: "Software from before everything looked the same.",
    curator: { name: "Dana Okonkwo", handle: "dana" },
    saveCount: 173,
    followerCount: 2840,
  },
  {
    id: "c5",
    title: "Low Season",
    description: "Empty resorts, closed kiosks, out-of-service funiculars.",
    curator: { name: "Sam Ellery", handle: "sam" },
    saveCount: 38,
    followerCount: 205,
  },
  {
    id: "c6",
    title: "Kitchen Table Research",
    description: "Home experiments, written up properly.",
    curator: { name: "Priya Raman", handle: "priya" },
    saveCount: 122,
    followerCount: 890,
  },
];

/**
 * What is inside each community gallery, as `[title, aspectRatio]`.
 *
 * Kept in this shape rather than as full `Artifact` literals because the only fields
 * that differ per item are the title and the shape of the picture — everything else is
 * derived in `communityArtifacts` below. Thumbnails are seeded from the gallery id and
 * the index, so a given tile always shows the same image.
 */
const COMMUNITY_ITEMS: Record<string, ReadonlyArray<readonly [string, number]>> = {
  c1: [
    ["Barbican walkway, March", 0.75],
    ["Boston City Hall, wet", 1.4],
    ["Stair core, Sheffield", 0.7],
    ["Trellick from the canal", 0.8],
    ["Car park roof, Preston", 1.5],
    ["Chapel, Clermont-Ferrand", 0.9],
  ],
  c2: [
    ["Original, 1968", 1],
    ["The cover version", 1],
    ["Sample credits, side B", 0.75],
    ["Same riff, thirty years on", 1.5],
    ["Liner notes", 0.8],
  ],
  c3: [
    ["Doorway, Gion", 0.7],
    ["Noren at midday", 1.3],
    ["Rain on the Kamo", 1.5],
    ["Machiya lattice", 0.75],
    ["Cedar, Arashiyama", 0.85],
    ["Vending machine, 2am", 0.7],
  ],
  c4: [
    ["System 7 control panels", 1.5],
    ["Winamp skins archive", 1.3],
    ["The original iPod wheel", 1],
    ["BeOS Tracker", 1.6],
    ["Nokia 3310 menus", 0.7],
    ["Braun ET66", 0.9],
  ],
  c5: [
    ["Funicular, out of service", 0.75],
    ["Kiosk, shuttered", 1.4],
    ["Pool drained for winter", 1.5],
    ["Deck chairs stacked", 0.9],
  ],
  c6: [
    ["Sourdough, day nine", 0.8],
    ["Kombucha pH log", 1.4],
    ["Germination tray", 1],
    ["Notebook spread", 0.75],
    ["Fermentation temps", 1.5],
  ],
};

/**
 * Builds the artifacts shown inside a community gallery.
 *
 * These are somebody else's saves, so they deliberately do not reuse `ARTIFACTS` — a
 * curator's gallery full of your own items would misrepresent what the tab is for.
 */
export function communityArtifacts(galleryId: string): Artifact[] {
  const items = COMMUNITY_ITEMS[galleryId] ?? [];

  return items.map(([title, aspectRatio], index) => ({
    id: `${galleryId}-${index}`,
    kind: "image",
    title,
    tags: [],
    imageUrl: thumb(`musea-${galleryId}-${index}`, 600, Math.round(600 / aspectRatio)),
    aspectRatio,
    sourceType: "gallery",
    // Community items are browse-only here, so the exact save date is not rendered.
    savedAt: "2026-06-01T00:00:00.000Z",
    galleryIds: [galleryId],
    status: "ready",
  }));
}

/** Cover mosaic for a community gallery — the first three of its items. */
export function communityCoverUrls(galleryId: string): string[] {
  return communityArtifacts(galleryId)
    .slice(0, 3)
    .map((artifact) => artifact.imageUrl)
    .filter((url): url is string => Boolean(url));
}

export const PROFILE: Profile = {
  name: "Ibrahim Najjar",
  handle: "ibo",
  bio: "Collecting buildings, typefaces and things made slowly.",
  joinedAt: "2025-11-02T00:00:00.000Z",
};

const OWN_ARTIFACT_IDS = new Set(ARTIFACTS.map((artifact) => artifact.id));

/**
 * Whether an artifact is one of yours.
 *
 * Decides which actions a card offers and whether the detail sheet talks about "your"
 * galleries — you cannot delete, or have filed, somebody else's save.
 */
export function isOwnArtifact(artifact: Artifact): boolean {
  return OWN_ARTIFACT_IDS.has(artifact.id);
}

export function artifactsInGallery(galleryId: string): Artifact[] {
  return ARTIFACTS.filter((artifact) => artifact.galleryIds.includes(galleryId));
}

export function galleriesForArtifact(artifact: Artifact): Gallery[] {
  return GALLERIES.filter((gallery) => artifact.galleryIds.includes(gallery.id));
}

/** First three thumbnails in a gallery — the cover mosaic. */
export function galleryCoverUrls(gallery: Gallery): string[] {
  return artifactsInGallery(gallery.id)
    .map((artifact) => artifact.imageUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);
}
