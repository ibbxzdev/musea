import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Musea — data model.
 *
 * This is the web port of the iOS app's Convex backend. The table names differ from the
 * phone repo in two places and nowhere else:
 *
 *   phone `artificats`  → `artifacts`   (the phone repo's typo is not worth inheriting)
 *   phone `gallery`     → `galleries`   (already here, and `Id<"galleries">` is baked into
 *                                        every Stellar function — renaming it would ripple
 *                                        through a deliverable this change has no business
 *                                        touching)
 *
 * Fields are otherwise a straight port, minus everything that only exists to serve a
 * feature the web version does not have:
 *
 *   - `embedding` / the vector index — no AI. Search is the Convex full-text index on
 *     `searchText` below, which is maintained on write in convex/model/artifacts.ts.
 *   - `isAuto` / `autoFileDisabled` / `excludedGalleryIds` — all three exist only for the
 *     LLM auto-filer. With no auto-filer, a gallery is always one the user made.
 *
 * `users` is keyed to the Better Auth subject; see convex/auth.ts.
 */

/** Where an artifact came from. Decided once at save time, never re-derived at render. */
export const sourceTypeValidator = v.union(
  v.literal("pinterest"),
  v.literal("x"),
  v.literal("youtube"),
  v.literal("reddit"),
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("gallery"),
  v.literal("files"),
  v.literal("link"),
  v.literal("note"),
);

/**
 * What an artifact *is*, which decides how its card renders and which filter chip it
 * answers to.
 *
 * The phone repo derives this at query time with `.filter()` over `image`/`videoUrl`/
 * `sourceType`, which is a table scan wearing a WHERE clause's clothes. Storing it makes
 * the filter an index range instead — see `by_user_kind`.
 */
export const artifactKindValidator = v.union(
  v.literal("image"),
  v.literal("video"),
  v.literal("note"),
  v.literal("link"),
);

/** Enrichment state. `pending` and `failed` both get a badge on the card. */
export const artifactStatusValidator = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    /** Better Auth user id (the `subject` in ctx.auth.getUserIdentity()). */
    authSubject: v.string(),
    name: v.string(),
    handle: v.string(),
    imageUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_authSubject", ["authSubject"])
    .index("by_handle", ["handle"]),

  galleries: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    /**
     * Whether anyone may see this gallery and what is filed in it.
     *
     * The phone app has no sharing at all — every gallery is the owner's. The web app has
     * a Community page and a tip button, and both need *something* a stranger is allowed
     * to open. Making that an explicit opt-in rather than "a gallery is public once you
     * file something in it" is the difference between publishing and leaking.
     *
     * Optional rather than required because the table is already populated on the dev
     * deployment; absent reads as false everywhere.
     */
    isPublic: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId", "createdAt"])
    .index("by_public", ["isPublic", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  /**
   * Who uploaded which file.
   *
   * Convex storage has no owner of its own: `ctx.storage.generateUploadUrl()` hands back
   * an id, and any later mutation that is given that id will happily use it. Without this
   * table, `artifacts.create({ imageStorageId })` would accept *any* storage id a caller
   * passed — so someone who learned another user's id could attach their file to an
   * artifact and then delete it out from under them by deleting that artifact.
   *
   * The row is written by `files.claimUpload` immediately after the upload POST, and it
   * is write-once: a storage id that already has an owner cannot be re-claimed.
   */
  files: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_user", ["userId"]),

  artifacts: defineTable({
    userId: v.id("users"),
    kind: artifactKindValidator,
    title: v.string(),
    description: v.optional(v.string()),

    /**
     * Thumbnail on a host we do not control — an `og:image`, an oEmbed thumbnail. Held as
     * a URL because that is all a scrape gives us; nothing is copied into our storage.
     */
    imageUrl: v.optional(v.string()),
    /**
     * Thumbnail the user uploaded. The *id*, never the URL: a Convex storage URL is
     * resolved per read with `ctx.storage.getUrl`, and a persisted one goes stale.
     */
    imageStorageId: v.optional(v.id("_storage")),
    /** width ÷ height, when it is known. Lets the masonry column reserve the box. */
    aspectRatio: v.optional(v.number()),

    videoUrl: v.optional(v.string()),
    /** Original URL, when there is one to go back to. */
    source: v.optional(v.string()),
    sourceType: sourceTypeValidator,

    /** Author of the source content, when the platform exposes one. Best-effort. */
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    authorImage: v.optional(v.string()),

    tags: v.array(v.string()),
    status: artifactStatusValidator,

    /**
     * Lowercased title + description + tags, rebuilt on every write.
     *
     * A Convex search index covers exactly one field, and the app searches across three.
     * Denormalising them into one string is the sanctioned way to do that; the single
     * writer is `searchTextFor` in convex/model/artifacts.ts, so it cannot drift as long
     * as nothing else calls `ctx.db.patch("artifacts", …)` directly.
     */
    searchText: v.string(),

    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_kind", ["userId", "kind", "createdAt"])
    /** Dedupe on save: "have I already kept this link?" without scanning the library. */
    .index("by_user_source", ["userId", "source"])
    .searchIndex("by_searchText", {
      searchField: "searchText",
      filterFields: ["userId", "kind"],
    }),

  /**
   * Artifact ↔ gallery, many-to-many.
   *
   * An artifact filed in three galleries is one artifact, not three — which is the whole
   * reason this is a join table and not a `galleryId` column.
   */
  galleryArtifacts: defineTable({
    galleryId: v.id("galleries"),
    artifactId: v.id("artifacts"),
    /** Denormalised owner, so "everything this user filed" is one index read on delete. */
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_gallery", ["galleryId", "createdAt"])
    .index("by_artifact", ["artifactId"])
    .index("by_user", ["userId"]),

  // ----------------------------------------------------------------- Stellar

  /**
   * ⚠ ORPHANED — app-managed custodial wallets, from before wallets became the user's own.
   *
   * **No code reads or writes this table any more.** Every function that did is deleted:
   * `stellar/wallets.ts`, `stellar/walletsNode.ts` and `stellar/crypto.ts` are gone, and
   * nothing can decrypt `encryptedSecret` any longer — the ciphertext outlives its only
   * reader.
   *
   * It is still declared **only because rows exist**, and Convex refuses to push a schema
   * that omits a populated table. Those rows hold testnet USDC in accounts nobody can now
   * spend from, so purging them destroys (worthless) funds — a deliberate decision, not a
   * cleanup to slip into an unrelated change.
   *
   * **Delete the rows, then delete this table.** Leaving encrypted key material in the
   * database contradicts CLAUDE.md rule 3, which is the whole point of the change that
   * orphaned it.
   */
  stellarWallets: defineTable({
    userId: v.id("users"),
    /** G... public key. Safe to expose to the client. */
    publicKey: v.string(),
    /** AES-256-GCM ciphertext of the S... secret key. Unreadable: the key module is gone. */
    encryptedSecret: v.string(),
    /** Provisioning is multi-step and can fail partway; these track where it got to. */
    funded: v.boolean(),
    trustlineReady: v.boolean(),
    seeded: v.boolean(),
    /** Last known USDC balance in stroops, stored as a string (bigint isn't a Convex type). */
    cachedBalanceStroops: v.optional(v.string()),
    balanceUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_publicKey", ["publicKey"]),

  /**
   * A wallet the user brought themselves — Freighter today.
   *
   * Deliberately a separate table from `stellarWallets` rather than a `kind` column on it.
   * `stellarWallets`'s invariant is "every row has an `encryptedSecret`", which is what
   * makes the authz test asserting `getMyWallet` never serializes that field meaningful.
   * An external wallet has no secret to hold — we only ever know its public address — and
   * collapsing the two would weaken a check that exists to protect key material.
   *
   * There is no secret here, and there never can be: the key lives in the user's browser
   * extension and this backend cannot reach it.
   */
  externalWallets: defineTable({
    userId: v.id("users"),
    /** G... address reported by the wallet. Public by construction. */
    publicKey: v.string(),
    /** Freighter's network at link time, e.g. "TESTNET". A mainnet wallet must not tip. */
    network: v.string(),
    linkedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_publicKey", ["publicKey"]),

  tips: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    galleryId: v.id("galleries"),
    fromPublicKey: v.string(),
    toPublicKey: v.string(),
    /** sha256(galleryId) as hex — the BytesN<32> the contract keys totals by. */
    galleryHashHex: v.string(),
    /** Authoritative amount, i128 stroops as a string. Display is derived from this. */
    amountStroops: v.string(),
    txHash: v.optional(v.string()),
    /**
     * For externally-signed (Freighter) tips only: the hash of the transaction this server
     * built and handed to the wallet. Signing does not change a transaction's hash, so on
     * submit we can prove the envelope coming back is the one we built and not a
     * substitute. Absent on managed-wallet tips, which never leave the server.
     */
    preparedTxHash: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("success"), v.literal("failed")),
    /** Classified code from @musea/shared errors, not a raw Stellar string. */
    errorCode: v.optional(v.string()),
    /** Full server-side detail for debugging. Never rendered to the client. */
    errorDetail: v.optional(v.string()),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_from", ["fromUserId", "createdAt"])
    .index("by_to", ["toUserId", "createdAt"])
    .index("by_gallery", ["galleryId"])
    .index("by_txHash", ["txHash"])
    .index("by_status", ["status"]),
});
