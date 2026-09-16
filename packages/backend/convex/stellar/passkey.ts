import { v } from "convex/values";
import { action, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { getCurrentUser, requireCurrentUserIdFromAction } from "../model/auth";

/**
 * WebAuthn credential-creation options, as the browser's `startRegistration` wants them.
 *
 * Spelled out rather than inferred: without an explicit return type the action's type is
 * resolved through `ctx.runAction`, which resolves back through this module, and Convex's
 * typecheck rejects the cycle ("implicitly has type 'any' because it is referenced
 * directly or indirectly in its own initializer").
 */
type RegistrationOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { alg: number; type: "public-key" }[];
  authenticatorSelection: {
    authenticatorAttachment: "platform";
    residentKey: "required";
    userVerification: "required";
  };
  timeout: number;
  attestation: "none";
};

/**
 * Passkey smart accounts — the public, auth-guarded surface (Story 2B.1).
 *
 * Auth guards and nothing else; the Stellar work is in `./passkeyNode.ts`. No Stellar
 * imports here, so this module stays in the default Convex runtime and its guards stay
 * reachable from `convex-test`. Never `import` the node module; go through
 * `internal.stellar.passkeyNode.*`.
 *
 * **Nothing here takes a `userId`.** Whose wallet is being created, and who is tipping
 * from it, is always whoever `ctx.auth` says is calling — CLAUDE.md rule 2. A
 * client-supplied id on any of these would let one user provision or spend as another.
 */

/**
 * The signed-in user's smart account, or null.
 *
 * A plain reactive query rather than an action, so the profile card, the tip sheet and the
 * gallery button all re-render together the moment an account is provisioned — they cannot
 * disagree about whether a wallet exists.
 *
 * Everything returned is public by construction: a contract address that is on-chain and a
 * credential id that is a public WebAuthn handle. There is no secret in this table to omit
 * — by design, not by omission.
 */
export const getMyWallet = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      contractAddress: v.string(),
      status: v.union(v.literal("pending"), v.literal("deployed"), v.literal("failed")),
      funded: v.boolean(),
      rpId: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const account = await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!account) return null;

    // Projected field by field rather than spread, so a column added to this table later
    // cannot start being served to the client by accident.
    return {
      contractAddress: account.contractAddress,
      status: account.status,
      funded: account.funded,
      rpId: account.rpId,
      createdAt: account.createdAt,
    };
  },
});

/**
 * Can this gallery's curator receive a tip at all?
 *
 * Tips go to the curator's own smart account, so a curator who has never set one up cannot
 * be paid. Without this the tipper finds that out *after* choosing an amount and
 * authenticating, which is a dead end dressed up as a working button.
 *
 * Public and unauthenticated, matching `getGalleryTotal`: a signed-out visitor sees the
 * same galleries and should see the same affordance. It reveals only whether a curator has
 * a wallet, never which address.
 */
export const curatorAcceptsTips = query({
  args: { galleryId: v.id("galleries") },
  returns: v.boolean(),
  handler: async (ctx, { galleryId }) => {
    const gallery = await ctx.db.get(galleryId);
    if (!gallery) return false;

    const account = await ctx.db
      .query("smartAccounts")
      .withIndex("by_user", (q) => q.eq("userId", gallery.ownerId))
      .unique();

    return account?.status === "deployed";
  },
});

/**
 * Step 1 of creating a wallet: the WebAuthn options the browser needs.
 *
 * Nothing is created here and nothing is persisted — this hands back a challenge and the
 * parameters of the credential to make. It is a separate round trip because Safari
 * consumes user activation across an `await`: the browser must already hold these options
 * when the user taps, or `navigator.credentials.create()` is called outside the gesture
 * and the Face ID sheet silently never appears.
 */
export const startRegistration = action({
  args: {},
  handler: async (ctx): Promise<RegistrationOptions> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    const user = await ctx.runQuery(internal.stellar.internal.getUser, { userId });
    return await ctx.runAction(internal.stellar.passkeyNode.buildRegistrationOptions, {
      userId,
      userName: user?.handle ?? "musea",
    });
  },
});

/**
 * Step 2: turn the created credential into a deployed, funded smart account.
 *
 * Idempotent — a user who already has a deployed account gets its address back rather than
 * a second account, which would strand whatever the first one held.
 */
export const finishRegistration = action({
  args: { registrationResponse: v.any() },
  handler: async (ctx, { registrationResponse }): Promise<string> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    const user = await ctx.runQuery(internal.stellar.internal.getUser, { userId });
    return await ctx.runAction(internal.stellar.passkeyNode.provisionSmartAccount, {
      userId,
      userName: user?.handle ?? "musea",
      registrationResponse,
    });
  },
});

/**
 * The signed-in user's spendable balance, in stroops.
 *
 * Read from the native SAC rather than Horizon: a `C…` smart account has no classic
 * account, so Horizon would 404 on it forever.
 */
export const getMyBalance = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    const account = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
      userId,
    });
    if (!account || account.status !== "deployed") return "0";
    return await ctx.runAction(internal.stellar.passkeyNode.readSmartAccountBalance, {
      contractAddress: account.contractAddress,
    });
  },
});

/**
 * Fill the signed-in user's wallet if it is empty, and return the resulting balance.
 *
 * Needed because deploying an account and funding it are separate steps that fail
 * separately — a wallet can exist, correctly, and still hold nothing. No passkey prompt:
 * funding credits the account, and crediting an account needs no authorization from it.
 */
export const fundMyWallet = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    return await ctx.runAction(internal.stellar.passkeyNode.topUpSmartAccount, { userId });
  },
});

/**
 * Forget the signed-in user's smart account.
 *
 * Deliberately does **not** touch anything on-chain: the account stays deployed and keeps
 * its balance, and the passkey stays on the device. This only detaches it from the Musea
 * profile, so re-registering on the same device resolves to the same account again.
 */
export const forgetWallet = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireCurrentUserIdFromAction(ctx);
    await ctx.runMutation(internal.stellar.internal.deleteSmartAccount, { userId });
    return null;
  },
});
