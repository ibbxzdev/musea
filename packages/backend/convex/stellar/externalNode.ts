"use node";

import * as StellarSdk from "@stellar/stellar-sdk";
import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { classifyStellarError, toStroops, userMessageFor } from "@musea/shared";
import { stellarConfig } from "./config";
import { TipError, detailFor, galleryHash, resolveCuratorAddress } from "./tipsNode";

/**
 * Tipping from a wallet the user brought themselves — Freighter (Story F.1).
 *
 * The managed path in `./tipsNode.ts` does build → simulate → assemble → sign → send → poll
 * in one action, because it holds the key. Here the key is in a browser extension we cannot
 * reach, so the same lifecycle is cut in half at exactly one point:
 *
 *   prepareTip   build → simulate → assemble → record pending → return unsigned XDR
 *   (browser)    Freighter signs the XDR. This is the ONLY step off this server.
 *   submitTip    verify it is the envelope we built → send → poll → record
 *
 * **CLAUDE.md rule 1 still holds.** The browser receives an opaque XDR string and hands it
 * to an extension; it imports no Stellar package and builds no transaction. Everything
 * Stellar-shaped is still here.
 *
 * **The tipId round-trips through the client**, which makes it a client-supplied id — the
 * shape rule 2 exists for. `getOwnedPendingTip` re-derives ownership from `ctx.auth` on the
 * way back in; never trust the id alone.
 *
 * `internalAction`s, so `fromUserId` is safe here. The auth-guarded surface is
 * `./external.ts`.
 */

/** Matches the managed path so fee behaviour does not differ by wallet kind. */
const INCLUSION_FEE = "1000000";
const POLL_ATTEMPTS = 30;

/**
 * Freighter reports its network as a name, not a passphrase. Map it once, here, so a
 * mainnet wallet is refused before it can sign anything against a testnet contract.
 */
function networkMatches(walletNetwork: string, passphrase: string): boolean {
  const expected =
    passphrase === StellarSdk.Networks.PUBLIC
      ? "PUBLIC"
      : passphrase === StellarSdk.Networks.TESTNET
        ? "TESTNET"
        : null;
  return expected !== null && walletNetwork.toUpperCase() === expected;
}

export const prepareExternalTip = internalAction({
  args: {
    fromUserId: v.id("users"),
    galleryId: v.id("galleries"),
    amount: v.string(),
  },
  handler: async (
    ctx,
    { fromUserId, galleryId, amount },
  ): Promise<{ tipId: Id<"tips">; xdr: string }> => {
    try {
      const cfg = stellarConfig();
      const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);

      // ── 1. The tipper's linked wallet ──────────────────────────────────────────────
      const external = await ctx.runQuery(internal.stellar.internal.getExternalWalletByUser, {
        userId: fromUserId,
      });
      if (!external) {
        throw new TipError("WALLET_NOT_CONNECTED", "No external wallet linked to this user.");
      }
      if (!networkMatches(external.network, cfg.networkPassphrase)) {
        throw new TipError(
          "WALLET_NETWORK_MISMATCH",
          `Wallet is on ${external.network}; this deployment is not.`,
        );
      }

      // ── 2. Gallery and curator ─────────────────────────────────────────────────────
      const gallery = await ctx.runQuery(internal.stellar.internal.getGallery, { galleryId });
      if (!gallery) throw new TipError("UNKNOWN", `Gallery ${galleryId} does not exist.`);
      if (gallery.ownerId === fromUserId) {
        throw new TipError("SELF_TIP", "Tipper owns this gallery.");
      }

      // The tip goes to the creator's own wallet. No Musea-provisioned fallback: see
      // `resolveCuratorAddress`.
      const toPublicKey = await resolveCuratorAddress(ctx, gallery.ownerId);

      // ── 3. Amount ──────────────────────────────────────────────────────────────────
      let stroops: bigint;
      try {
        stroops = toStroops(amount);
      } catch (error) {
        throw new TipError(
          "INVALID_AMOUNT",
          error instanceof Error ? error.message : String(error),
        );
      }

      const hash = galleryHash(galleryId);

      // ── 4. Build ───────────────────────────────────────────────────────────────────
      // The tipper's own account is the transaction source, exactly as in the managed
      // path, so one signature satisfies both `tip`'s `require_auth` and the SAC
      // transfer's inner one with no separately assembled auth entry. Freighter signing
      // as the source is the same shape the managed path gets from a local keypair.
      //
      // Pre-flight the connected wallet against Horizon before building anything.
      //
      // Both failures below would otherwise surface as a simulation error, and the managed
      // path's wording for them is actively wrong here: it says "still being set up, try
      // again in a moment", which is true of provisioning we control and false of a wallet
      // the user owns. Nothing we do will fund their account or add their trustline — only
      // they can — so the error has to name the action rather than ask them to wait.
      const horizon = new StellarSdk.Horizon.Server(cfg.horizonUrl);
      let account: Awaited<ReturnType<typeof horizon.loadAccount>>;
      try {
        account = await horizon.loadAccount(external.publicKey);
      } catch {
        throw new TipError(
          "WALLET_NOT_FUNDED",
          `${external.publicKey} does not exist on this network.`,
        );
      }

      // A SAC transfer from an account with no trustline for the asset reverts the whole
      // invocation with Error(Contract, #13). Catching it here costs one read and turns an
      // opaque contract error into an instruction.
      const hasTrustline = account.balances.some(
        (balance) =>
          balance.asset_type !== "native" &&
          "asset_code" in balance &&
          balance.asset_code === cfg.usdcAssetCode &&
          balance.asset_issuer === cfg.usdcIssuer,
      );
      if (!hasTrustline) {
        throw new TipError(
          "WALLET_NO_TRUSTLINE",
          `${external.publicKey} holds no ${cfg.usdcAssetCode} trustline.`,
        );
      }

      const source = await rpc.getAccount(external.publicKey);
      const contract = new StellarSdk.Contract(cfg.tipjarContractId);

      const built = new StellarSdk.TransactionBuilder(source, {
        fee: INCLUSION_FEE,
        networkPassphrase: cfg.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "tip",
            StellarSdk.Address.fromString(external.publicKey).toScVal(),
            StellarSdk.Address.fromString(toPublicKey).toScVal(),
            StellarSdk.xdr.ScVal.scvBytes(hash),
            StellarSdk.nativeToScVal(stroops, { type: "i128" }),
          ),
        )
        // Longer than the managed path's 60s: a human has to notice a browser-extension
        // popup, read it, and click. A transaction that expires while the wallet is open
        // fails at submit with a bad sequence and looks like a bug.
        .setTimeout(180)
        .build();

      // ── 5. Simulate ────────────────────────────────────────────────────────────────
      // Before the user is asked to approve anything. A tip that cannot succeed should
      // never reach a wallet popup — refusing here costs nothing and asking costs trust.
      const sim = await rpc.simulateTransaction(built);
      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      // ── 6. Assemble ────────────────────────────────────────────────────────────────
      // Without this the resource fee is missing and the transaction fails on submit —
      // after the user has approved it, which is the worst place to discover it.
      const prepared = StellarSdk.rpc.assembleTransaction(built, sim).build();
      const preparedTxHash = Buffer.from(prepared.hash()).toString("hex");

      // ── 7. Record pending ──────────────────────────────────────────────────────────
      // After assembling (we need the hash) but before the envelope leaves this server,
      // so nothing can ever be submitted without a row to reconcile against. Also carries
      // the double-submit guard.
      const tipId: Id<"tips"> = await ctx.runMutation(internal.stellar.internal.recordTipPending, {
        fromUserId,
        toUserId: gallery.ownerId,
        galleryId,
        fromPublicKey: external.publicKey,
        toPublicKey,
        galleryHashHex: hash.toString("hex"),
        amountStroops: stroops.toString(),
        preparedTxHash,
      });

      return { tipId, xdr: prepared.toXDR() };
    } catch (error) {
      const code = error instanceof TipError ? error.code : classifyStellarError(error);
      console.error(`prepare tip failed: ${code}`);
      throw new ConvexError({ code, message: userMessageFor(code) });
    }
  },
});

export const submitExternalTip = internalAction({
  args: {
    fromUserId: v.id("users"),
    tipId: v.id("tips"),
    signedXdr: v.string(),
  },
  handler: async (
    ctx,
    { fromUserId, tipId, signedXdr },
  ): Promise<{ status: "success"; txHash: string }> => {
    const cfg = stellarConfig();
    const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);

    // ── 1. Ownership ─────────────────────────────────────────────────────────────────
    // The id came back from the client. Re-derive that it is this caller's, and still
    // pending, before touching it. A wrong or foreign id is indistinguishable from a
    // stale one to the user, so they get the same message.
    const tip = await ctx.runQuery(internal.stellar.internal.getOwnedPendingTip, {
      tipId,
      userId: fromUserId,
    });
    if (!tip) {
      throw new ConvexError({
        code: "UNKNOWN" as const,
        message: userMessageFor("UNKNOWN"),
      });
    }

    try {
      // ── 2. Verify the envelope is ours ─────────────────────────────────────────────
      // Signing does not change a transaction's hash, so the envelope coming back must
      // hash to what we built. This is what stops a modified transaction — different
      // amount, different recipient — from being submitted under a tip row that says
      // otherwise. Without it our database could describe a transfer that never happened.
      const parsed = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        cfg.networkPassphrase,
      ) as StellarSdk.Transaction;

      if (Buffer.from(parsed.hash()).toString("hex") !== tip.preparedTxHash) {
        throw new TipError(
          "TRANSACTION_MISMATCH",
          `Signed envelope for tip ${tipId} does not match the prepared transaction.`,
        );
      }

      // ── 3. Send ────────────────────────────────────────────────────────────────────
      const sent = await rpc.sendTransaction(parsed);
      if (sent.status === "ERROR") {
        throw new Error(`Submit rejected: ${JSON.stringify(sent.errorResult)}`);
      }

      // ── 4. Poll ────────────────────────────────────────────────────────────────────
      const settled = await rpc.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
      if (settled.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND) {
        // May still land. The row keeps the hash so it stays reconcilable, and the user is
        // pointed at Activity rather than told it definitely failed.
        throw new TipError("TIMEOUT", `Timed out awaiting confirmation of ${sent.hash}.`);
      }
      if (settled.status !== StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`Transaction ${settled.status}: ${sent.hash}`);
      }

      await ctx.runMutation(internal.stellar.internal.markTipSuccess, { tipId, txHash: sent.hash });
      return { status: "success", txHash: sent.hash };
    } catch (error) {
      const code = error instanceof TipError ? error.code : classifyStellarError(error);
      console.error(`tip ${tipId} failed at submit: ${code}`);

      await ctx.runMutation(internal.stellar.internal.markTipFailed, {
        tipId,
        errorCode: code,
        errorDetail: detailFor(error),
      });
      throw new ConvexError({ code, message: userMessageFor(code) });
    }
  },
});

/**
 * Fund and seed a connected external wallet — **development only**.
 *
 * Run from the CLI against a testnet address:
 *
 *   npx convex run stellar/externalNode:fundExternalWallet '{"publicKey":"G..."}'
 *
 * `internalAction`, so it is unreachable from any client: it spends the project treasury
 * and takes the destination as an argument, which is exactly the shape that must never be
 * publicly callable. There is no user in scope here and no `ctx.auth` to derive one from —
 * the CLI's admin key is the authorization, which is why this stays internal.
 *
 * Deliberately NOT idempotent on the seed step: "already
 * funded" is observable on-chain and safe to re-check, but "already seeded" is not — an
 * account holding 100 USDC looks the same whether it was seeded once or twice. Re-running
 * this doubles the balance. That is acceptable for a dev helper and would not be for
 * anything user-facing.
 */
export const fundExternalWallet = internalAction({
  args: { publicKey: v.string() },
  handler: async (
    _ctx,
    { publicKey },
  ): Promise<{ funded: boolean; seeded: boolean; note: string }> => {
    // Check the shape before spending a network round trip on it. Friendbot answers a
    // malformed address with a bare HTTP 400, which surfaces as "Friendbot funding failed"
    // and sends you looking at Friendbot — when the real fault is the argument, most often
    // a placeholder pasted from documentation without substitution.
    if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
      throw new Error(
        `"${publicKey}" is not a Stellar public key. Expected 56 characters beginning with G — copy the address from your wallet, and substitute it for any placeholder.`,
      );
    }

    const cfg = stellarConfig();
    const horizon = new StellarSdk.Horizon.Server(cfg.horizonUrl);
    const usdc = new StellarSdk.Asset(cfg.usdcAssetCode, cfg.usdcIssuer);

    // ── 1. Friendbot, if the account does not exist yet ───────────────────────────────
    let funded = false;
    let account: Awaited<ReturnType<typeof horizon.loadAccount>> | null = null;
    try {
      account = await horizon.loadAccount(publicKey);
    } catch {
      const response = await fetch(`${cfg.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
      if (!response.ok) {
        throw new Error(`Friendbot funding failed (HTTP ${response.status}).`);
      }
      funded = true;
      account = await horizon.loadAccount(publicKey);
    }

    // ── 2. The trustline is the user's to create, not ours ────────────────────────────
    // It needs a signature from the key we do not hold. Report rather than fail, so the
    // funding half is not wasted and the next step is obvious.
    const hasTrustline = account.balances.some(
      (balance) =>
        balance.asset_type !== "native" &&
        "asset_code" in balance &&
        balance.asset_code === cfg.usdcAssetCode &&
        balance.asset_issuer === cfg.usdcIssuer,
    );
    if (!hasTrustline) {
      return {
        funded,
        seeded: false,
        note: `Funded with XLM, but ${publicKey} has no ${cfg.usdcAssetCode} trustline. Add it in your wallet (asset ${cfg.usdcAssetCode}, issuer ${cfg.usdcIssuer}), then run this again to receive USDC.`,
      };
    }

    // ── 3. Seed from the treasury ─────────────────────────────────────────────────────
    const treasury = StellarSdk.Keypair.fromSecret(cfg.treasurySecret);
    const treasuryAccount = await horizon.loadAccount(treasury.publicKey());
    const seedTx = new StellarSdk.TransactionBuilder(treasuryAccount, {
      fee: "10000",
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: publicKey,
          asset: usdc,
          amount: cfg.seedAmount,
        }),
      )
      .setTimeout(60)
      .build();
    seedTx.sign(treasury);
    await horizon.submitTransaction(seedTx);

    return {
      funded,
      seeded: true,
      note: `Sent ${cfg.seedAmount} ${cfg.usdcAssetCode} to ${publicKey}.`,
    };
  },
});
