import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser, requireCurrentUser, requireCurrentUserIdFromAction } from "../model/auth";

/**
 * External (user-brought) wallets — the public surface. Freighter today.
 *
 * Auth guards and nothing else; the Stellar work is in `./externalNode.ts`. No Stellar
 * imports here, so this module stays in the default Convex runtime and its guards stay
 * reachable from `convex-test`.
 *
 * **Nothing here takes a `userId`.** Which wallet is being linked, and who is tipping from
 * it, is always whoever `ctx.auth` says is calling (CLAUDE.md rule 2). `submitTip` does
 * take a `tipId` — it has to, the browser is holding it between the two halves of the
 * flow — and that is precisely why `getOwnedPendingTip` re-checks ownership server-side.
 *
 * Never `import` the node module here; go through `internal.stellar.externalNode.*`.
 */

/** A `G...` Stellar public key: 56 chars, base32, no ambiguity with a `C...` contract id. */
const PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * The signed-in user's linked external wallet, or null.
 *
 * A plain reactive query rather than an action so the connect button, the profile card and
 * the tip sheet all re-render together the moment a wallet is linked or dropped — the
 * same reason the profile card and the tip sheet never disagree about it.
 *
 * Everything returned here is public by construction: an address the user just told their
 * browser extension to reveal. There is no secret in this table to omit.
 */
export const getMyExternalWallet = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      publicKey: v.string(),
      network: v.string(),
      linkedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const wallet = await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!wallet) return null;

    // Projected field by field rather than spread, so a column added to this table later
    // cannot start being served to the client by accident.
    return {
      publicKey: wallet.publicKey,
      network: wallet.network,
      linkedAt: wallet.linkedAt,
    };
  },
});

/**
 * Can this gallery's creator receive a tip at all?
 *
 * Tips go to the creator's own wallet with no fallback, so a creator who has never
 * connected one cannot be paid. Without this the tipper finds that out *after* choosing an
 * amount and tapping Send, which is a dead end dressed up as a working button.
 *
 * Only checks that a wallet is linked — whether the account actually exists on the network
 * needs Horizon, which a query cannot reach. `prepareTip` still does the full check before
 * anything is signed; this exists to stop the obvious case early, not to replace it.
 *
 * Public and unauthenticated, matching `getGalleryTotal`: a signed-out visitor sees the
 * same galleries and should see the same affordance. It reveals only whether a curator has
 * connected a wallet, never which address.
 */
export const curatorAcceptsTips = query({
  args: { galleryId: v.id("galleries") },
  returns: v.boolean(),
  handler: async (ctx, { galleryId }) => {
    const gallery = await ctx.db.get(galleryId);
    if (!gallery) return false;

    const wallet = await ctx.db
      .query("externalWallets")
      .withIndex("by_user", (q) => q.eq("userId", gallery.ownerId))
      .unique();

    return wallet !== null;
  },
});

/**
 * Record which external address the signed-in user tips from.
 *
 * **What this does not do is prove ownership of the address.** The user could paste
 * someone else's. That is deliberate, and it is safe for what this is used for: every tip
 * from this address requires a signature from the wallet holding its key, so claiming an
 * address you do not control buys you nothing — the transaction simply never gets signed.
 *
 * What it does leak is a balance: a linked address's funded state is visible to the user
 * who linked it. Since a Stellar address's balance is public on the network anyway, this
 * exposes nothing that Stellar Expert does not. A challenge-signature at link time would
 * close even that, and is the right thing to add if this ever moves off testnet.
 */
export const linkWallet = mutation({
  args: {
    publicKey: v.string(),
    /** Network name as the wallet reports it, e.g. "TESTNET". */
    network: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { publicKey, network }) => {
    const user = await requireCurrentUser(ctx);

    if (!PUBLIC_KEY_RE.test(publicKey)) {
      throw new ConvexError({
        code: "UNKNOWN" as const,
        message: "That doesn't look like a Stellar address.",
      });
    }

    await ctx.runMutation(internal.stellar.internal.linkExternalWallet, {
      userId: user._id,
      publicKey,
      network: network.toUpperCase(),
    });
    return null;
  },
});

/** Forget the signed-in user's external wallet. Tipping is unavailable until one is linked. */
export const unlinkWallet = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    await ctx.runMutation(internal.stellar.internal.unlinkExternalWallet, { userId: user._id });
    return null;
  },
});

/**
 * Step 1 of an external tip: build it and hand back an unsigned envelope to sign.
 *
 * Nothing is spent here and nothing is submitted. The tip is simulated first, so a tip that
 * cannot succeed is refused before the user is ever shown a wallet popup.
 */
export const prepareTip = action({
  args: {
    galleryId: v.id("galleries"),
    /** Display amount, e.g. "5". Converted to stroops server-side. */
    amount: v.string(),
  },
  handler: async (ctx, { galleryId, amount }): Promise<{ tipId: Id<"tips">; xdr: string }> => {
    const fromUserId = await requireCurrentUserIdFromAction(ctx);
    return await ctx.runAction(internal.stellar.externalNode.prepareExternalTip, {
      fromUserId,
      galleryId,
      amount,
    });
  },
});

/**
 * Release a prepared tip whose signature never arrived.
 *
 * `prepareTip` records the tip as `pending` before the wallet is asked to sign, which also
 * arms the double-submit guard in `recordTipPending`. That ordering is right for the
 * managed path, where recording precedes submission by milliseconds. Here a human sits in
 * the middle and can close the popup — and without this, their own abandoned attempt locks
 * them out of retrying the same gallery for a full minute, which reads as the app being
 * broken rather than as a guard doing its job.
 *
 * Nothing was submitted at prepare time, so cancelling costs nothing on-chain.
 *
 * Best-effort and silent: a tip that is missing, not the caller's, or no longer pending is
 * simply not cancelled. This runs inside a failure path the user is already being told
 * about, and a second error about the cleanup would only obscure the first.
 */
export const cancelPreparedTip = mutation({
  args: { tipId: v.id("tips") },
  returns: v.null(),
  handler: async (ctx, { tipId }) => {
    const user = await requireCurrentUser(ctx);

    const tip = await ctx.db.get(tipId);
    if (!tip || tip.fromUserId !== user._id || tip.status !== "pending") return null;

    await ctx.db.patch(tipId, { status: "failed", errorCode: "SIGNATURE_REJECTED" });
    return null;
  },
});

/**
 * Step 2 of an external tip: submit what the wallet signed.
 *
 * `tipId` is client-supplied by necessity — the browser held it across the signing step.
 * The node action re-derives that it belongs to this caller and is still pending, and
 * verifies the signed envelope hashes to the transaction this server actually built.
 */
export const submitTip = action({
  args: {
    tipId: v.id("tips"),
    signedXdr: v.string(),
  },
  handler: async (ctx, { tipId, signedXdr }): Promise<{ status: "success"; txHash: string }> => {
    const fromUserId = await requireCurrentUserIdFromAction(ctx);
    return await ctx.runAction(internal.stellar.externalNode.submitExternalTip, {
      fromUserId,
      tipId,
      signedXdr,
    });
  },
});
