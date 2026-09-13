import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Musea Curator Tips — data model.
 *
 * `galleries` and `users` here are the minimal standalone stand-ins for Musea's real
 * tables so this repo demos end-to-end on its own. When this merges back into Musea,
 * these two tables are the seam: everything in `stellar/` refers to them only through
 * the helpers in `model/`, so swapping them out should not reach into the Stellar code.
 *
 * Better Auth owns its own tables inside the component (see convex.config.ts), so there is
 * no `authAccounts`/`sessions` table here. `users` holds our app-level profile and is keyed
 * to the Better Auth subject.
 */
export default defineSchema({
  users: defineTable({
    /** Better Auth user id (the `subject` in ctx.auth.getUserIdentity()). */
    authSubject: v.string(),
    name: v.string(),
    handle: v.string(),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_authSubject", ["authSubject"])
    .index("by_handle", ["handle"]),

  galleries: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_createdAt", ["createdAt"]),

  /** Items inside a gallery. Present so a gallery looks real in the demo. */
  galleryItems: defineTable({
    galleryId: v.id("galleries"),
    kind: v.union(v.literal("link"), v.literal("image"), v.literal("quote")),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    text: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_gallery", ["galleryId"]),

  // ----------------------------------------------------------------- Stellar

  stellarWallets: defineTable({
    userId: v.id("users"),
    /** G... public key. Safe to expose to the client. */
    publicKey: v.string(),
    /**
     * AES-256-GCM ciphertext of the S... secret key, as JSON {iv, ct, tag}.
     * NEVER returned to the client. NEVER logged. Decrypted in memory inside a Node
     * action at signing time only. See convex/stellar/crypto.ts.
     */
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
