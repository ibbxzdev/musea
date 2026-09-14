import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser } from "./model/auth";

/**
 * Tip history — the caller's Activity feed (Story 2.6).
 *
 * Distinct from `convex/stellar/tips.ts`, which is the Stellar action surface. This is a
 * plain database read, so it is a reactive `query`: the Activity list updates itself when
 * a pending tip flips to success, with no polling in the UI.
 */

/**
 * Every tip the signed-in user sent or received, newest first.
 *
 * Takes no `userId`. A tip history is exactly the kind of data a client-supplied id would
 * leak, and there is no legitimate reason to read someone else's.
 */
export const listMyTips = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    const user = await getCurrentUser(ctx);
    // Signed out is an empty feed, not an error — this renders on a page that a visitor
    // may reach before signing in.
    if (!user) return [];

    const take = Math.min(limit, 100);

    // Two indexes rather than one scan: `by_from` and `by_to` are each ordered by
    // createdAt, so taking `limit` from each and merging gives the true newest `limit`
    // overall without reading the whole table.
    const [sent, received] = await Promise.all([
      ctx.db
        .query("tips")
        .withIndex("by_from", (q) => q.eq("fromUserId", user._id))
        .order("desc")
        .take(take),
      ctx.db
        .query("tips")
        .withIndex("by_to", (q) => q.eq("toUserId", user._id))
        .order("desc")
        .take(take),
    ]);

    const merged = [...sent, ...received].sort((a, b) => b.createdAt - a.createdAt).slice(0, take);

    return await Promise.all(merged.map((tip) => shapeTip(ctx, tip, user._id)));
  },
});

/**
 * Shape a tip row for the client.
 *
 * Explicitly field-by-field rather than spreading the document. `errorDetail` holds raw
 * Horizon/RPC output for server-side debugging and must never reach a browser; spreading
 * would ship it the moment someone adds a field, and that is the kind of leak nobody
 * notices in review.
 */
async function shapeTip(ctx: QueryCtx, tip: Doc<"tips">, viewerId: Id<"users">) {
  const [gallery, counterparty] = await Promise.all([
    ctx.db.get(tip.galleryId),
    ctx.db.get(tip.fromUserId === viewerId ? tip.toUserId : tip.fromUserId),
  ]);

  return {
    _id: tip._id,
    direction: tip.fromUserId === viewerId ? ("sent" as const) : ("received" as const),
    galleryId: tip.galleryId,
    galleryTitle: gallery?.title ?? "Removed gallery",
    counterparty: counterparty
      ? { name: counterparty.name, handle: counterparty.handle, imageUrl: counterparty.imageUrl }
      : null,
    amountStroops: tip.amountStroops,
    status: tip.status,
    txHash: tip.txHash,
    /** The classified code only. `userMessageFor` turns it into something readable. */
    errorCode: tip.errorCode,
    createdAt: tip.createdAt,
    confirmedAt: tip.confirmedAt,
  };
}
