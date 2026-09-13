"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";

/**
 * Tipping — the headline flow (Deliverable 2).
 *
 * ┌─ SCAFFOLD ─────────────────────────────────────────────────────────────────────────┐
 * │ This file defines the surface and the required order of operations. The bodies are  │
 * │ Story 2.3 / 2.4 work. Read docs/Musea_Stellar_Implementation_Spec.md §6.4 for the   │
 * │ reference implementation, and the `dapp` + `smart-contracts` skills for SDK detail. │
 * └────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Non-negotiables, in rough order of how much they cost to get wrong:
 *
 * 1. **No `userId` argument.** The tipper is whoever is signed in. Derive it with
 *    `requireCurrentUserIdFromAction(ctx)`. Accepting a caller-supplied id here means
 *    anyone can drain anyone's wallet. See convex/model/auth.ts.
 *
 * 2. **Record the tip as `pending` BEFORE submitting**, and patch it to success/failed
 *    after. If the action dies between submit and confirm, a pending row is a lead;
 *    no row at all is a tip that happened on-chain and exists nowhere in the app.
 *
 * 3. **Amounts go through `@musea/shared`** (`toStroops`/`fromStroops`). Do not do ad-hoc
 *    `amount * 1e7` arithmetic — that is the bug the shared package exists to prevent.
 *
 * 4. **Soroban lifecycle is build → simulate → assemble → sign → send → poll.** Skipping
 *    `assemble` omits the resource fee and the transaction fails. Classic payments are
 *    the shorter build → sign → submit; contract calls are not.
 *
 * 5. **The tipper is the transaction source**, which is what satisfies `require_auth`
 *    inside the contract without a separate auth entry.
 *
 * 6. **Never log a decrypted secret**, including inside a caught error. Log the classified
 *    code from `@musea/shared/errors` plus the tip id.
 */

/**
 * Send a tip to the curator of `galleryId`.
 *
 * Implementation order (each step depends on the previous):
 *   1. `requireCurrentUserIdFromAction(ctx)` -> the tipper.
 *   2. Load the gallery; reject if missing, or if the tipper owns it (the contract
 *      rejects self-tips with SelfTip, but failing early is a better experience).
 *   3. Load the tipper's wallet; reject if not provisioned.
 *   4. Load the curator's wallet; auto-provision it if absent. A curator who has never
 *      opened the app has no USDC trustline, and the SAC transfer would fail `op_no_trust`.
 *   5. Convert the amount with `toStroops`; check it against the cached balance.
 *   6. Insert the `pending` tip row (internalMutation) and keep the id.
 *   7. Build the contract call, simulate, assemble, sign with the tipper's key, send.
 *   8. Poll `getTransaction` until it leaves NOT_FOUND, with a ~30s ceiling.
 *   9. Patch the row to success (with txHash) or failed (with a classified errorCode).
 */
export const sendTip = action({
  args: {
    galleryId: v.id("galleries"),
    /** Display amount, e.g. "5". Converted to stroops server-side. */
    amount: v.string(),
  },
  handler: async (_ctx, _args): Promise<{ status: "success"; txHash: string }> => {
    throw new Error("Not implemented — see Story 2.3 and spec §6.4.");
  },
});

/**
 * Read a gallery's total tipped, live from TipJar contract state.
 *
 * This MUST come from the contract, not from summing the `tips` table. The whole point of
 * Deliverable 1 is that the number is publicly verifiable on-chain; if it ever renders
 * from our own database, the demo is asserting something it hasn't proven.
 *
 * Implementation notes:
 *   - Simulate-only. A view call needs no signature and costs nothing; build a tx from any
 *     funded account (the treasury works) and read `sim.result.retval`.
 *   - Returns stroops as a string; the UI formats with `formatUsdc`.
 */
export const getGalleryTotal = action({
  args: { galleryId: v.id("galleries") },
  handler: async (_ctx, _args): Promise<string> => {
    throw new Error("Not implemented — see Story 2.5 and spec §6.4.");
  },
});

/** Read a curator's lifetime total received, from contract state. */
export const getCuratorTotal = action({
  args: { userId: v.id("users") },
  handler: async (_ctx, _args): Promise<string> => {
    throw new Error("Not implemented — see Story 2.5.");
  },
});
