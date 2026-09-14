import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireCurrentUserIdFromAction } from "../model/auth";

/**
 * On-chain tip totals — the public read surface.
 *
 * Sending lives in `./external.ts`: tips are signed by the user's own wallet, so the flow
 * is prepare → sign in the browser → submit, not a single server-side action. The
 * app-managed sending path that used to live here is gone, along with the keys it needed.
 *
 * Auth guards and nothing else; the Stellar work is in `./tipsNode.ts`. No Stellar imports
 * here, so this module stays in the default Convex runtime and its guards are reachable
 * from `convex-test`. Never `import` the node module; go through `internal.stellar.tipsNode.*`.
 */

/**
 * A gallery's total tipped, live from TipJar contract state, in stroops.
 *
 * Public and unauthenticated on purpose: a signed-out visitor can browse galleries and see
 * their on-chain totals, matching the read policy in convex/galleries.ts. Only tipping
 * needs a session. Nothing user-scoped is exposed — this is public chain data either way.
 */
export const getGalleryTotal = action({
  args: { galleryId: v.id("galleries") },
  handler: async (ctx, { galleryId }): Promise<string> => {
    return await ctx.runAction(internal.stellar.tipsNode.readGalleryTotal, { galleryId });
  },
});

/**
 * The signed-in curator's lifetime total received, from contract state, in stroops.
 *
 * Reads the caller's **connected** wallet, because that is where tips are now paid. It
 * previously read the app-managed account, which under the current model would report 0
 * forever — the contract credits the address that actually received the transfer.
 *
 * Returns "0" for a curator who has not connected a wallet: they have no address for the
 * contract to have credited, which is genuinely a zero rather than a missing answer.
 *
 * Scoped to the caller rather than taking a `userId`. While a curator total is arguably
 * public, resolving a user id to a Stellar address for any caller hands out a mapping we
 * otherwise keep to ourselves.
 */
export const getMyCuratorTotal = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    const wallet = await ctx.runQuery(internal.stellar.internal.getExternalWalletByUser, {
      userId,
    });
    if (!wallet) return "0";
    return await ctx.runAction(internal.stellar.tipsNode.readCuratorTotal, {
      publicKey: wallet.publicKey,
    });
  },
});
