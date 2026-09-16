import { v } from "convex/values";

import { action, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireCurrentUser, requireCurrentUserIdFromAction } from "../model/auth";

/**
 * Tipping — the public, auth-guarded surface (Stories 2B.3 / 2.5).
 *
 * Auth guards and nothing else; the Stellar work is in `./tipsNode.ts`. No Stellar imports
 * here, so this module stays in the default Convex runtime and its guards stay reachable
 * from `convex-test`. Never `import` the node module; go through
 * `internal.stellar.tipsNode.*`.
 *
 * **Nothing here takes a `userId`.** Who is tipping is whoever `ctx.auth` says is calling.
 * `submitTip` does take a `tipId` — it has to, the browser holds it across the Face ID
 * prompt — and that is precisely why `getOwnedPendingTip` re-checks ownership server-side.
 */

/**
 * Step 1 of a tip: build it and hand back a challenge to sign.
 *
 * Nothing is spent here and nothing is submitted. The tip is simulated first, so a tip
 * that cannot succeed is refused before the user is ever asked for their face.
 *
 * What comes back is deliberately minimal: an opaque tip id and 32 bytes to sign. The
 * transaction itself never leaves the server, so there is no envelope for a client to
 * tamper with and none to re-verify on the way back.
 */
export const prepareTip = action({
  args: {
    galleryId: v.id("galleries"),
    /** Display amount, e.g. "5". Converted to stroops server-side. */
    amount: v.string(),
  },
  handler: async (
    ctx,
    { galleryId, amount },
  ): Promise<{ tipId: Id<"tips">; challenge: string; credentialId: string; rpId: string }> => {
    const fromUserId = await requireCurrentUserIdFromAction(ctx);
    return await ctx.runAction(internal.stellar.tipsNode.prepareTip, {
      fromUserId,
      galleryId,
      amount,
    });
  },
});

/**
 * Step 2 of a tip: submit what the device signed.
 *
 * `tipId` is client-supplied by necessity — the browser held it across the Face ID prompt.
 * The node action re-derives that it belongs to this caller and is still pending, and
 * checks the assertion answers the challenge this tip issued.
 */
export const submitTip = action({
  args: {
    tipId: v.id("tips"),
    /** The WebAuthn AuthenticationResponseJSON the device produced. */
    assertion: v.any(),
  },
  handler: async (ctx, { tipId, assertion }): Promise<{ status: "success"; txHash: string }> => {
    const fromUserId = await requireCurrentUserIdFromAction(ctx);
    return await ctx.runAction(internal.stellar.tipsNode.submitTip, {
      fromUserId,
      tipId,
      assertion,
    });
  },
});

/**
 * Release a prepared tip whose signature never arrived.
 *
 * `prepareTip` records the tip as `pending` before the device is asked to sign, which also
 * arms the double-submit guard. A human sits in the middle and can dismiss the Face ID
 * sheet — and without this, their own cancelled attempt would lock them out of retrying
 * the same gallery for a full minute, which reads as the app being broken rather than as a
 * guard doing its job.
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

    await ctx.db.patch(tipId, {
      status: "failed",
      errorCode: "SIGNATURE_REJECTED",
      // Drop the in-flight state with the tip: it is transient, and the XDR is the largest
      // thing on the row.
      preparedXdr: undefined,
      authChallenge: undefined,
      signatureExpirationLedger: undefined,
    });
    return null;
  },
});

/**
 * A gallery's total tipped, live from TipJar contract state, in stroops.
 *
 * Public and unauthenticated on purpose: a signed-out visitor can browse galleries and see
 * their on-chain totals, matching the read policy in convex/galleries.ts. Only tipping
 * needs a session. Nothing user-scoped is exposed — this is public chain data either way.
 */
export const getGalleryTotal = action({
  args: { galleryId: v.id("galleries") },
  returns: v.object({ stroops: v.string(), contractId: v.string() }),
  handler: async (ctx, { galleryId }): Promise<{ stroops: string; contractId: string }> => {
    return await ctx.runAction(internal.stellar.tipsNode.readGalleryTotal, { galleryId });
  },
});

/**
 * The signed-in curator's lifetime total received, from contract state, in stroops.
 *
 * This is the second number in the app that comes off the chain rather than out of our
 * tables, and it is the one the Activity page leads with — so the list of tips underneath
 * it is checkable against contract state rather than merely asserted by us. TipJar has
 * exposed `curator_total` since Deliverable 1; until now nothing read it.
 *
 * A curator with no deployed wallet gets `{ stroops: "0", contractId: null }`: there is no
 * address for the contract to have credited, so the zero is a real answer — but there is
 * also nothing on-chain to link to, and saying so beats pointing at a contract that has
 * never heard of them.
 *
 * Scoped to the caller rather than taking a `userId`. While a curator total is arguably
 * public, resolving a user id to a Stellar address for any caller hands out a mapping we
 * otherwise keep to ourselves.
 */
export const getMyCuratorTotal = action({
  args: {},
  returns: v.object({ stroops: v.string(), contractId: v.union(v.string(), v.null()) }),
  handler: async (ctx): Promise<{ stroops: string; contractId: string | null }> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    const account = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
      userId,
    });
    if (!account || account.status !== "deployed") return { stroops: "0", contractId: null };
    return await ctx.runAction(internal.stellar.tipsNode.readCuratorTotal, {
      address: account.contractAddress,
    });
  },
});
