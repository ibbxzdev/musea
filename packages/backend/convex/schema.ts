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
   * A user's non-custodial passkey smart account (SOW §4.2, Story 2B.1).
   *
   * **Every field here is public by construction.** The contract address is on-chain, the
   * credential id is a public WebAuthn handle, and the public key is, definitionally,
   * public. The signing key was generated inside the device's Secure Enclave and is not
   * extractable — not by the browser, not by us. There is deliberately no field here that
   * a total backend compromise could turn into a spend, which is CLAUDE.md rule 3 and the
   * reason the custodial `stellarWallets` table this replaces is gone rather than migrated.
   *
   * One row per user: `by_user` is the lookup every tip goes through, and a second account
   * would make "which address am I tipping from" ambiguous.
   */
  smartAccounts: defineTable({
    userId: v.id("users"),
    /** C... smart account contract address. This is what a tip is paid from and into. */
    contractAddress: v.string(),
    /** base64url WebAuthn credential id — which passkey signs for this account. */
    credentialId: v.string(),
    /** 65-byte uncompressed secp256r1 public key, hex. The on-chain signer's identity. */
    publicKeyHex: v.string(),

    /**
     * The Relying Party ID the credential was created under.
     *
     * Persisted rather than assumed, because a passkey only resolves under the domain that
     * created it. A row written against `localhost` is unusable on the deployed site and
     * vice versa; storing the RP ID is what lets the app say so instead of surfacing an
     * inscrutable WebAuthn failure.
     */
    rpId: v.string(),

    /**
     * Immutable birth provenance, verified against on-chain history on every connect.
     *
     * Not decoration: `connectWallet` refuses an account whose birth it cannot verify, and
     * with these three absent it falls back to the public indexer — which does not serve
     * the claim the kit wants, so that path fails permanently rather than transiently.
     * We submit the deployment ourselves and therefore know all three; persisting them is
     * what keeps the indexer off the critical path entirely. See Story 2B.0, finding 3.
     *
     * Optional because a row exists from the moment deployment is attempted, and these are
     * only knowable once it has landed.
     */
    birthWasmHash: v.optional(v.string()),
    /**
     * Hash of the immutable constructor argument vector, from the deployment itself.
     *
     * What makes a stored credential "locally approved" in Smart Account Kit: a credential
     * carrying it is one this app deployed and can verify against its own record, so
     * connecting skips the fresh-WebAuthn-assertion check. Without it the kit demands an
     * assertion on every connect — which a Convex action cannot produce, since the
     * authenticator is on the user's phone.
     */
    birthConstructorArgsHash: v.optional(v.string()),
    creationTransactionHash: v.optional(v.string()),
    creationLedger: v.optional(v.number()),

    /**
     * Provisioning is several network round trips and can fail partway; the retry path is
     * the one that actually gets exercised, so where it got to has to be legible.
     */
    status: v.union(v.literal("pending"), v.literal("deployed"), v.literal("failed")),
    /** Server-side detail for a failed deployment. Never rendered to the client raw. */
    deploymentError: v.optional(v.string()),
    /** Whether the account has been given its starting test XLM. */
    funded: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_contractAddress", ["contractAddress"])
    .index("by_credentialId", ["credentialId"]),

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
     * Historical, from the Freighter era: the hash of the transaction handed to the
     * extension, used to prove the signed envelope coming back was the one we built.
     * Nothing writes it now — under the passkey model the prepared transaction never
     * leaves the server, so there is no envelope to re-verify. Kept so existing rows
     * still validate.
     */
    preparedTxHash: v.optional(v.string()),

    /**
     * The passkey flow's in-flight state, held between `prepareTip` and `submitTip`.
     *
     * The signature crosses to the browser and back, but **the transaction never does**.
     * Keeping it here rather than round-tripping it through the client is what removes a
     * whole class of problem: there is no client-supplied envelope to validate, because
     * the client was never given one. The browser holds an opaque tip id and a challenge.
     *
     * Both must survive unchanged, because the auth digest the passkey signed is derived
     * from exactly this transaction and this expiration ledger. Rebuild either and the
     * digest moves, and `__check_auth` rejects a signature that is otherwise perfectly
     * valid.
     *
     * Context rule ids are deliberately *not* stored. They are resolved from chain state
     * by the kit, identically in both halves, and duplicating that resolution here is how
     * the two would drift — the contract wants one id per auth context, and a `tip` has
     * two (the call, and the SAC transfer nested under it).
     *
     * Cleared once the tip reaches a terminal state — it is transient state, not a record,
     * and the XDR is the largest thing on the row.
     */
    preparedXdr: v.optional(v.string()),
    signatureExpirationLedger: v.optional(v.number()),
    /**
     * base64url of the auth digest handed to the browser as the WebAuthn challenge.
     *
     * Kept so `submitTip` can assert the assertion coming back answers *this* challenge.
     * The kit recomputes the digest independently and would fail anyway on a mismatch, but
     * it fails deep inside signing with a message about context rules. Checking here turns
     * the single most likely passkey bug into a named error instead of a puzzle.
     */
    authChallenge: v.optional(v.string()),
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
