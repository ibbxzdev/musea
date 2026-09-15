"use node";

import { createHash } from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { ConvexError, v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { classifyStellarError, toStroops, userMessageFor, type TipErrorCode } from "@musea/shared";
import { stellarConfig } from "./config";
import { connectedKitFor, readSacBalance } from "./passkeyNode";

/**
 * Tipping — the Stellar half (Stories 2B.3 / 2B.4 / 2.5).
 *
 * A tip is one contract call, split across two actions because the signature comes from
 * the user's device and a Convex action cannot call a browser:
 *
 *   prepareTip   build -> simulate -> assemble -> derive the auth digest  ─┐
 *                                                                          ▼
 *   (browser)                       navigator.credentials.get({ challenge })  -> Face ID
 *                                                                          │
 *   submitTip    attach the assertion -> re-simulate -> submit gaslessly  ◄┘
 *
 * **The transaction never leaves this server.** Only the challenge goes out and only an
 * assertion comes back, so there is no client-supplied envelope to validate — the class of
 * bug the old Freighter path needed `preparedTxHash` to defend against does not exist here.
 * The browser holds an opaque tip id and 32 bytes to sign.
 *
 * The rules that cost the most to get wrong:
 *
 *   - **Re-simulate after signing.** A WebAuthn signature is far larger than the
 *     placeholder used at first simulation, so the assembled resource fee is wrong until
 *     the transaction is simulated again with the real signature in place. The kit's
 *     submit path does this; skipping it fails on submit, after Face ID, which is the
 *     worst possible moment.
 *   - **Never recompute the auth digest by hand.** It binds the context rule ids, and a
 *     `tip` has two auth contexts (the call, and the SAC transfer nested inside it).
 *     `prepareTip` gets the challenge by running the kit's own signing path and stopping
 *     it the instant it reaches for the device, so both halves derive the digest from
 *     identical code. Story 2B.0, finding 1.
 *   - **Nothing raw crosses this boundary.** Every failure leaves as a `ConvexError` with
 *     a classified code and a sentence written for a human; the full text goes to
 *     `tips.errorDetail`, server-side only.
 */

/**
 * How long a signature stays valid, in ledgers (~5s each). 720 ≈ one hour.
 *
 * Generous because a human sits in the middle: they have to notice the Face ID sheet,
 * read it and authenticate. It bounds replay, not user patience.
 */
const SIGNATURE_EXPIRATION_LEDGERS = 720;

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

// ──────────────────────────────────────────────────────────────────────── prepare

export const prepareTip = internalAction({
  args: {
    fromUserId: v.id("users"),
    galleryId: v.id("galleries"),
    amount: v.string(),
  },
  handler: async (
    ctx,
    { fromUserId, galleryId, amount },
  ): Promise<{ tipId: Id<"tips">; challenge: string; credentialId: string; rpId: string }> => {
    try {
      const cfg = stellarConfig();

      // ── 1. Who is paying ───────────────────────────────────────────────────────────
      const account = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
        userId: fromUserId,
      });

      // ── 2. Gallery and curator ─────────────────────────────────────────────────────
      const gallery = await ctx.runQuery(internal.stellar.internal.getGallery, { galleryId });
      if (!gallery) throw new TipError("UNKNOWN", `Gallery ${galleryId} does not exist.`);
      if (gallery.ownerId === fromUserId) {
        throw new TipError("SELF_TIP", "Tipper owns this gallery.");
      }
      const toAddress = await resolveCuratorAddress(ctx, gallery.ownerId);

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

      // Connecting verifies the account's on-chain birth, so it also answers "is this
      // wallet real and usable" before the user is asked to authenticate.
      const { kit, account: connected } = await connectedKitFor(account);

      // Checked before Face ID rather than after. Simulation would catch it, but only as
      // an SAC error surfacing once the user has already authenticated — asking someone
      // for their face and then saying "insufficient funds" is the wrong order.
      const balance = await readSacBalance(connected.contractAddress);
      if (balance < stroops) {
        throw new TipError(
          "INSUFFICIENT_BALANCE",
          `${connected.contractAddress} holds ${balance} stroops, needs ${stroops}.`,
        );
      }

      const hash = galleryHash(galleryId);

      // ── 4. Build + simulate + assemble ─────────────────────────────────────────────
      // Routed through the smart account's own `execute`, so the account is the caller
      // and `from` — which is what makes `require_auth` dispatch to its `__check_auth`.
      const tx = await kit.execute(cfg.tipjarContractId, "tip", [
        StellarSdk.Address.fromString(connected.contractAddress).toScVal(),
        StellarSdk.Address.fromString(toAddress).toScVal(),
        StellarSdk.xdr.ScVal.scvBytes(hash),
        StellarSdk.nativeToScVal(stroops, { type: "i128" }),
      ]);

      const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);
      const latest = await rpc.getLatestLedger();
      const expiration = latest.sequence + SIGNATURE_EXPIRATION_LEDGERS;

      // ── 5. Derive the challenge ────────────────────────────────────────────────────
      // By running the kit's real signing path and stopping it where it would call the
      // device. See the note at the top of this file: computing the digest independently
      // means reimplementing private context-rule resolution, and getting it subtly wrong
      // produces a signature the contract rejects for reasons that read as unrelated.
      const challenge = await captureAuthChallenge(kit, tx, connected.credentialId, expiration);

      // ── 6. Record ──────────────────────────────────────────────────────────────────
      // After assembling but before anything is signed, so nothing can be submitted
      // without a row to reconcile against. Also arms the double-submit guard.
      const tipId: Id<"tips"> = await ctx.runMutation(internal.stellar.internal.recordTipPending, {
        fromUserId,
        toUserId: gallery.ownerId,
        galleryId,
        fromPublicKey: connected.contractAddress,
        toPublicKey: toAddress,
        galleryHashHex: hash.toString("hex"),
        amountStroops: stroops.toString(),
      });

      await ctx.runMutation(internal.stellar.internal.attachPreparedTip, {
        tipId,
        preparedXdr: tx.toXDR(),
        signatureExpirationLedger: expiration,
        authChallenge: challenge,
      });

      return {
        tipId,
        challenge,
        credentialId: connected.credentialId,
        rpId: connected.rpId,
      };
    } catch (error) {
      const code = error instanceof TipError ? error.code : classifyStellarError(error);
      console.error(`prepare tip failed: ${code}`);
      throw new ConvexError({ code, message: userMessageFor(code) });
    }
  },
});

/**
 * Run signing far enough to learn the challenge, then abort.
 *
 * The kit computes the auth digest immediately before handing it to the authenticator, so
 * an injected `startAuthentication` that records the challenge and throws yields exactly
 * the bytes the device will be asked to sign — with no duplicated derivation to drift.
 * Nothing is submitted: the throw happens inside signing, well before the submit step.
 */
type ConnectedKit = Awaited<ReturnType<typeof connectedKitFor>>["kit"];
type PreparedTransaction = Awaited<ReturnType<ConnectedKit["execute"]>>;

async function captureAuthChallenge(
  kit: ConnectedKit,
  tx: PreparedTransaction,
  credentialId: string,
  expiration: number,
): Promise<string> {
  const ABORT = Symbol("challenge captured");
  let challenge: string | null = null;

  // `signAndSubmitAdmin` rather than `sign`, because a call routed through the account's
  // `execute` is a guarded wallet mutation that the generic signing path refuses.
  const kitWithShim = kit as unknown as {
    webAuthn?: { startAuthentication?: (a: { optionsJSON: { challenge: string } }) => unknown };
  };
  const original = kitWithShim.webAuthn?.startAuthentication;
  if (kitWithShim.webAuthn) {
    kitWithShim.webAuthn.startAuthentication = (args: { optionsJSON: { challenge: string } }) => {
      challenge = args.optionsJSON.challenge;
      throw ABORT;
    };
  }

  try {
    await kit.signAndSubmitAdmin(tx, { credentialId, expiration });
  } catch (error) {
    if (error !== ABORT) throw error;
  } finally {
    if (kitWithShim.webAuthn) kitWithShim.webAuthn.startAuthentication = original;
  }

  if (!challenge) {
    throw new TipError(
      "UNKNOWN",
      "Signing never reached the authenticator, so no challenge was produced.",
    );
  }
  return challenge;
}

// ───────────────────────────────────────────────────────────────────────── submit

export const submitTip = internalAction({
  args: {
    fromUserId: v.id("users"),
    tipId: v.id("tips"),
    /** The WebAuthn AuthenticationResponseJSON the device produced. */
    assertion: v.any(),
  },
  handler: async (
    ctx,
    { fromUserId, tipId, assertion },
  ): Promise<{ status: "success"; txHash: string }> => {
    const cfg = stellarConfig();

    // ── 1. Ownership ─────────────────────────────────────────────────────────────────
    // The id came back from the client. Re-derive that it is this caller's and still
    // pending before touching it — CLAUDE.md rule 2 applied to an id that must round-trip.
    const tip = await ctx.runQuery(internal.stellar.internal.getOwnedPendingTip, {
      tipId,
      userId: fromUserId,
    });
    if (!tip) {
      throw new ConvexError({ code: "UNKNOWN" as const, message: userMessageFor("UNKNOWN") });
    }

    try {
      if (!tip.preparedXdr || tip.signatureExpirationLedger == null || !tip.authChallenge) {
        throw new TipError("UNKNOWN", `Tip ${tipId} has no prepared state to submit.`);
      }

      const account = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
        userId: fromUserId,
      });

      // ── 2. The assertion must answer the challenge we issued ───────────────────────
      // The kit recomputes the digest and would fail anyway on a mismatch, but it fails
      // deep inside signing with a message about context rules. Checking here turns the
      // single most likely passkey bug into a named error instead of a puzzle.
      const answered = clientDataChallenge(assertion);
      if (answered !== tip.authChallenge) {
        throw new TipError(
          "CHALLENGE_MISMATCH",
          `Assertion answers "${answered}" but tip ${tipId} issued "${tip.authChallenge}".`,
        );
      }

      const { kit } = await connectedKitFor(account, {
        startAuthentication: async () => assertion,
      });

      // ── 3. Rehydrate the transaction prepared in step 1 ────────────────────────────
      const rehydrated = rehydrate(tip.preparedXdr, cfg);

      // ── 4. Sign, re-simulate, submit gaslessly ─────────────────────────────────────
      const result = await kit.signAndSubmitAdmin(rehydrated, {
        credentialId: account?.credentialId,
        expiration: tip.signatureExpirationLedger,
        forceMethod: "relayer",
      });

      if (!result.success) {
        // Submission methods report expected failures rather than throwing, so this is
        // the normal path for a contract or relayer refusal, not an exceptional one.
        throw new TipError(
          classifyKitFailure(result.error),
          `${result.error?.code ?? "?"}: ${result.error?.message ?? "submission failed"}`,
        );
      }

      await ctx.runMutation(internal.stellar.internal.markTipSuccess, {
        tipId,
        txHash: result.hash,
      });
      return { status: "success", txHash: result.hash };
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
 * Rebuild the AssembledTransaction that `prepareTip` persisted.
 *
 * Two things `fromXDR` does not do for us. It restores only `built`, while the kit's
 * signing path reads `simulationData` to locate the entry it is signing — and that is a
 * getter which *throws* `NotYetSimulated` rather than returning undefined, so optional
 * chaining does not save you. Setting its two backing fields is what makes the round trip
 * work. The auth entries themselves survive inside `built`, so nothing is fabricated here.
 *
 * `spec` is only reached through the lazy `parseResultXdr` closure, and `tip` returns void,
 * so a stub keeps the kit's bindings package — a transitive dependency — out of our graph.
 */
function rehydrate(preparedXdr: string, cfg: ReturnType<typeof stellarConfig>) {
  const tx = AssembledTransaction.fromXDR(
    {
      // The invoked contract is the smart account's own `execute`, so `contractId` here is
      // read back out of the envelope rather than being the TipJar address.
      contractId: invokedContractId(preparedXdr, cfg.networkPassphrase),
      networkPassphrase: cfg.networkPassphrase,
      rpcUrl: cfg.rpcUrl,
      publicKey: cfg.treasuryPublic,
      allowHttp: cfg.rpcUrl.startsWith("http://"),
    },
    preparedXdr,
    { funcResToNative: () => undefined } as never,
  );

  const withSimulation = tx as unknown as {
    simulationResult: unknown;
    simulationTransactionData: unknown;
    built: StellarSdk.Transaction;
  };
  const operation = withSimulation.built.operations[0] as StellarSdk.Operation.InvokeHostFunction;
  withSimulation.simulationResult = {
    auth: operation.auth ?? [],
    retval: StellarSdk.xdr.ScVal.scvVoid(),
  };
  withSimulation.simulationTransactionData = withSimulation.built
    .toEnvelope()
    .v1()
    .tx()
    .ext()
    .sorobanData();

  return tx;
}

/** The contract a prepared envelope invokes — the smart account, not TipJar. */
function invokedContractId(preparedXdr: string, networkPassphrase: string): string {
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    preparedXdr,
    networkPassphrase,
  ) as StellarSdk.Transaction;
  const operation = tx.operations[0] as StellarSdk.Operation.InvokeHostFunction;
  return StellarSdk.Address.fromScAddress(
    operation.func.invokeContract().contractAddress(),
  ).toString();
}

/**
 * The challenge a WebAuthn assertion actually answered.
 *
 * WebAuthn does not sign the challenge directly — it signs
 * `authenticatorData ‖ SHA256(clientDataJSON)`, with the challenge embedded in
 * `clientDataJSON`. So the only way to read it back is to decode that JSON.
 */
function clientDataChallenge(assertion: unknown): string | null {
  try {
    const encoded = (assertion as { response?: { clientDataJSON?: string } })?.response
      ?.clientDataJSON;
    if (typeof encoded !== "string") return null;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      challenge?: string;
    };
    return typeof parsed.challenge === "string" ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/** Separate a relayer refusal from a contract one — they need different advice. */
function classifyKitFailure(error: { code?: unknown; message?: string } | undefined): TipErrorCode {
  const text = `${String(error?.code ?? "")} ${error?.message ?? ""}`;
  if (/POOL_CAPACITY|UNREACHABLE|timed out/i.test(text)) return "RELAYER_UNAVAILABLE";
  if (/UNAUTHORIZED|FEE_LIMIT_EXCEEDED|INVALID_PARAMS|NO_HASH/i.test(text)) {
    return "RELAYER_REJECTED";
  }
  // 3110–3119 are the WebAuthn verifier's own codes: the signature did not check out.
  if (/\b31[01]\d\b/.test(text)) return "PASSKEY_AUTH_REJECTED";
  return classifyStellarError(text);
}

// ────────────────────────────────────────────────────────────────── contract reads

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
  args: { address: v.string() },
  handler: async (_ctx, { address }): Promise<string> => {
    return await simulateRead("curator_total", StellarSdk.Address.fromString(address).toScVal());
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
 * Where a gallery's tip goes: the curator's own passkey smart account.
 *
 * Derived from `gallery.ownerId` and never from anything a client sends.
 *
 * **No Horizon pre-flight here.** A `C…` smart account has no classic account, so
 * `loadAccount` would 404 on every curator forever. It also needs no trustline and no
 * prior funding to *receive* XLM — the SAC creates its balance entry on first credit — so
 * the only precondition left is that the account exists on-chain, which connecting the
 * tipper's own kit already proves for the payer and which simulation proves for the
 * recipient. Story 2B.0, finding 1.
 */
export async function resolveCuratorAddress(ctx: ActionCtx, ownerId: Id<"users">): Promise<string> {
  const curator = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
    userId: ownerId,
  });
  if (!curator || curator.status !== "deployed") {
    throw new TipError(
      "CURATOR_NOT_CONNECTED",
      `Gallery owner ${ownerId} has no deployed smart account.`,
    );
  }
  return curator.contractAddress;
}
