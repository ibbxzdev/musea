"use node";

import { action } from "../_generated/server";

/**
 * Custodial wallet provisioning (Deliverable 2).
 *
 * ┌─ SCAFFOLD ─────────────────────────────────────────────────────────────────────────┐
 * │ Surface and ordering are fixed here; bodies are Story 2.1 / 2.2. Reference          │
 * │ implementation: docs/Musea_Stellar_Implementation_Spec.md §6.3.                     │
 * └────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Provisioning is four network round trips that MUST happen in this order, because each
 * one is a precondition for the next:
 *
 *   1. Generate a keypair (`Keypair.random()`).
 *   2. **Friendbot** — until this succeeds the account does not exist on-chain, and
 *      everything after it 404s.
 *   3. **USDC trustline** (`changeTrust`, signed by the new key) — until this exists the
 *      account cannot hold USDC and payments to it fail `op_no_trust`.
 *   4. **Seed** test USDC from the treasury.
 *
 * Then encrypt the secret and persist via an internalMutation (actions cannot write).
 *
 * Two properties that matter more than they look:
 *
 * - **Idempotent.** Return early if a wallet row already exists. React Strict Mode
 *   double-invokes effects in dev, and a phone on a flaky connection retries. Creating a
 *   second wallet for a user orphans the first one's balance.
 *
 * - **Resumable.** The `funded` / `trustlineReady` / `seeded` booleans exist so a run that
 *   dies at step 3 can be picked up rather than restarted from a fresh keypair. Persist
 *   progress as you go rather than only at the end.
 */

/**
 * Ensure the signed-in user has a provisioned, funded, trustlined, seeded wallet.
 * Safe to call on every authenticated page load.
 *
 * Returns only the public key — never the secret, never the encrypted blob.
 */
export const provisionWallet = action({
  args: {},
  handler: async (_ctx): Promise<{ publicKey: string }> => {
    throw new Error("Not implemented — see Story 2.1 and spec §6.3.");
  },
});

/**
 * Refresh the signed-in user's USDC balance from Horizon and cache it.
 *
 * Horizon omits the asset entirely when there is no trustline (rather than returning
 * zero), so treat "absent" as 0 and surface it as "still setting up" rather than an error.
 */
export const refreshBalance = action({
  args: {},
  handler: async (_ctx): Promise<{ balanceStroops: string }> => {
    throw new Error("Not implemented — see Story 2.2 and spec §6.3.");
  },
});
