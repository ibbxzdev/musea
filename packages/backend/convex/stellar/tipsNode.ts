"use node";

import { createHash } from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { TipErrorCode } from "@musea/shared";
import { stellarConfig } from "./config";

/**
 * Tipping — the Stellar half (Stories 2.3 / 2.4 / 2.5).
 *
 * `internalAction`s, so a `userId` argument is safe: nothing here is client-reachable. The
 * public, auth-guarded surfaces are `./tips.ts` and `./external.ts`. See those for why the split
 * exists.
 *
 * The rules that cost the most to get wrong:
 *
 *   - **assemble.** A Soroban call is build → simulate → assemble → sign → send → poll.
 *     Skipping `assemble` omits the resource fee and the transaction fails. Classic
 *     payments are the shorter build → sign → submit; these are not those.
 *   - **Never log a decrypted secret**, including inside a `catch`. Log the classified
 *     code and the tip id.
 *   - **Nothing raw crosses this boundary.** Every failure leaves here as a `ConvexError`
 *     carrying a classified code and a sentence written for a human. Horizon and RPC
 *     errors are XDR-flavoured and meaningless to someone who just wanted to tip a dollar;
 *     the full text goes to `tips.errorDetail`, which is server-side only.
 */

/**
 * A failure we raised ourselves, carrying its classification.
 *
 * Our own preconditions do not need to be re-derived by pattern-matching their own message
 * text. `classifyStellarError` exists to interpret Stellar's output, where substring
 * matching is the only option; using it on strings we wrote ourselves just adds a way for
 * a reworded message to silently change a user-visible code.
 */
export class TipError extends Error {
  constructor(
    readonly code: TipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TipError";
  }
}

/**
 * The gallery key, as the contract sees it.
 *
 * `sha256(galleryId)` over the Convex document id string, as `BytesN<32>`. There must be
 * exactly one definition of this: hash the id differently in two places — trimmed,
 * lowercased, with a prefix — and the totals silently split across two contract keys that
 * each look perfectly plausible on their own.
 */
export function galleryHash(galleryId: string): Buffer {
  return createHash("sha256").update(galleryId).digest();
}

export const readGalleryTotal = internalAction({
  args: { galleryId: v.id("galleries") },
  handler: async (_ctx, { galleryId }): Promise<string> => {
    return await simulateRead(
      "gallery_total",
      StellarSdk.xdr.ScVal.scvBytes(galleryHash(galleryId)),
    );
  },
});

/** A curator's lifetime total received, from contract state, in stroops. */
export const readCuratorTotal = internalAction({
  args: { publicKey: v.string() },
  handler: async (_ctx, { publicKey }): Promise<string> => {
    return await simulateRead("curator_total", StellarSdk.Address.fromString(publicKey).toScVal());
  },
});

async function simulateRead(method: string, arg: StellarSdk.xdr.ScVal): Promise<string> {
  const cfg = stellarConfig();
  const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);

  const source = await rpc.getAccount(cfg.treasuryPublic);
  const contract = new StellarSdk.Contract(cfg.tipjarContractId);

  const tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(contract.call(method, arg))
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed reading ${method}: ${sim.error}`);
  }

  // Persistent entries archive after ~30 days without a write, and TipJar only extends TTL
  // on the `tip` path — reads never bump it (Epic 1, finding 3). When that happens the
  // simulation returns a restore preamble. Reporting "0" here would be a wrong number
  // presented as a fact, which is worse than a visible failure, so say so instead.
  if (StellarSdk.rpc.Api.isSimulationRestore(sim)) {
    throw new Error(
      `Contract state for ${method} is archived and needs RestoreFootprint before it reads.`,
    );
  }

  if (!sim.result) return "0";
  return (StellarSdk.scValToNative(sim.result.retval) as bigint).toString();
}

/**
 * Error text for `tips.errorDetail` — server-side only, never returned to a client.
 *
 * Capped because RPC failures can carry very large XDR blobs, and the point of this field
 * is to be readable by whoever is debugging a failed tip.
 */
export function detailFor(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 2000);
}

/**
 * Where a gallery's tip goes: the creator's own wallet, always.
 *
 * **There is no fallback to a Musea-provisioned account.** A tip is meant to reach the
 * person who made the gallery, in a wallet they hold the keys to — not an account we
 * custody on their behalf and that they currently have no way to withdraw from. A gallery
 * whose creator has not connected a wallet cannot be tipped, and says so.
 *
 * The recipient is derived from `gallery.ownerId` and never from anything a client sends.
 *
 * Both failures below are the curator's to fix, not ours: we hold none of their keys, so
 * we can neither fund their account nor add their trustline. The messages name the
 * situation rather than asking the tipper to wait for something that will never happen.
 */
export async function resolveCuratorAddress(ctx: ActionCtx, ownerId: Id<"users">): Promise<string> {
  const cfg = stellarConfig();

  const curator = await ctx.runQuery(internal.stellar.internal.getExternalWalletByUser, {
    userId: ownerId,
  });
  if (!curator) {
    throw new TipError("CURATOR_NOT_CONNECTED", `Gallery owner ${ownerId} has no linked wallet.`);
  }

  const horizon = new StellarSdk.Horizon.Server(cfg.horizonUrl);
  let account: Awaited<ReturnType<typeof horizon.loadAccount>>;
  try {
    account = await horizon.loadAccount(curator.publicKey);
  } catch {
    // Linked but never funded on this network — the address exists only as a string.
    throw new TipError("NO_TRUSTLINE", `Curator account ${curator.publicKey} does not exist.`);
  }

  // A SAC transfer to an account with no trustline for the asset reverts the whole
  // invocation with Error(Contract, #13), taking the tipper's fee with it.
  const hasTrustline = account.balances.some(
    (balance) =>
      balance.asset_type !== "native" &&
      "asset_code" in balance &&
      balance.asset_code === cfg.usdcAssetCode &&
      balance.asset_issuer === cfg.usdcIssuer,
  );
  if (!hasTrustline) {
    throw new TipError("NO_TRUSTLINE", `Curator ${curator.publicKey} holds no USDC trustline.`);
  }

  return curator.publicKey;
}
