import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import authConfig from "./auth.config";
import { passkeyAuth } from "./model/passkeyAuth";

/**
 * Better Auth, wired through the @convex-dev/better-auth component.
 *
 * Why this component rather than rolling auth ourselves: it makes the Better Auth session
 * and the Convex identity (`ctx.auth.getUserIdentity()`) the same thing. Every guard in
 * convex/model/auth.ts depends on that being true.
 *
 * Two pieces make it work, and both are easy to leave out:
 *
 *   1. `registerRoutes` in convex/http.ts. Without it there is no `/api/auth/convex/jwks`
 *      route, so Convex has no key set to validate tokens against and every identity is
 *      null — while the browser still shows a signed-in user.
 *   2. The `user.onCreate` trigger below. A Better Auth user lives inside the component's
 *      own tables; our `users` row is separate. Creating them together is what keeps them
 *      from drifting apart.
 */

/**
 * Annotating this breaks a type cycle, and the cycle is real rather than cosmetic:
 * `authComponent` is configured with references to `internal.auth.onCreate`/`onDelete`,
 * but those functions are themselves produced by `authComponent.triggersApi()` below.
 * Without the annotation TypeScript gives up with "implicitly has type 'any' because it is
 * referenced directly or indirectly in its own initializer". Only the types are circular —
 * the values are lazy function references, so nothing is circular at runtime.
 */
const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      /**
       * Create our profile row alongside the Better Auth user.
       *
       * `authUser._id` is the Better Auth user id, which is also the `sub` claim in the
       * JWT and therefore what `ctx.auth.getUserIdentity().subject` returns. That equality
       * is load-bearing: `getCurrentUser` looks the row up by it, so if it were ever
       * false, every guard would fail as "signed in but no profile" — forever, and
       * silently. Worth asserting once against a real sign-up rather than trusting.
       */
      onCreate: async (ctx, authUser) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_authSubject", (q) => q.eq("authSubject", authUser._id))
          .unique();
        if (existing) return;

        await ctx.db.insert("users", {
          authSubject: authUser._id,
          name: displayName(authUser.name, authUser.email),
          // The name first, not the email. Every user's address is now a synthetic
          // `…@passkey.invalid` derived from a credential id, so seeding the handle from
          // it would give every curator a 20-character slice of base64url as their public
          // @name. The chosen display name is the only human-meaningful thing we have.
          handle: await uniqueHandle(
            ctx,
            authUser.name ?? realEmail(authUser.email) ?? authUser._id,
          ),
          imageUrl: authUser.image ?? undefined,
          createdAt: Date.now(),
        });
      },

      /** Keep the two in step on the way out too, or the profile outlives the account. */
      onDelete: async (ctx, authUser) => {
        const row = await ctx.db
          .query("users")
          .withIndex("by_authSubject", (q) => q.eq("authSubject", authUser._id))
          .unique();
        if (row) await ctx.db.delete(row._id);
      },
    },
  },
});

/**
 * The internal mutations the component calls to fire the triggers above.
 *
 * These must be exported from this file, because `authFunctions` resolves them as
 * `internal.auth.onCreate` / `internal.auth.onDelete`.
 */
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),

    /**
     * **Email and password are gone. A passkey is the only way in.**
     *
     * Commit e32deb4 turned email sign-in back on because nothing else worked on a phone,
     * and said it had to stay "until something deliberately replaces it". This is that
     * replacement: `model/passkeyAuth.ts` is a real authentication method, distinct from
     * the tip-signing the passkey also does.
     *
     * Two consequences that are not bugs and should not be "fixed" by re-enabling this:
     *
     *   - **A lost device is a lost account.** There is no recovery path, because every
     *     recovery mechanism worth having — a second signer, social recovery, an email
     *     fallback — is either explicitly out of scope in SOW §4.1 or is the password this
     *     replaces. On testnet, holding nothing of value, that is an acceptable trade for
     *     a demo whose entire claim is that nobody but the user can authorize anything.
     *   - **`localhost` and the deployed domain hold separate accounts, permanently.** A
     *     passkey is bound to its Relying Party ID. That is inherent to WebAuthn, and it
     *     means development needs its own sign-up rather than a shared test login.
     */
    emailAndPassword: { enabled: false },

    /**
     * **Account deletion is off**, at the project owner's direction. The profile UI and the
     * `users.deleteAccount` mutation that called `auth.api.deleteUser` are both removed, so
     * nothing reaches this any more — and Better Auth exposes its own `/delete-user`
     * endpoint when this is enabled, which would otherwise stay live and reachable with no
     * UI in front of it and no cascade behind it. That is strictly worse than the feature
     * being gone: it would delete the Better Auth user and leave every artifact, gallery,
     * upload, passkey credential and wallet row behind, owned by a profile the `onDelete`
     * trigger had just removed.
     */
    user: { deleteUser: { enabled: false } },

    /**
     * Rate limiting, with one deliberate departure from the defaults.
     *
     * **storage: "database"**. The default is "memory", which on Convex means a counter
     * living inside one function isolate — isolates come and go per request, so the limit
     * silently does almost nothing. The Better Auth component ships a `rateLimit` table
     * for exactly this; using it is what makes Better Auth's own limits real.
     *
     * **The custom rules are back, and for the reason the SEP-0010 ones existed.** Better
     * Auth's strict 3-per-10s bucket keys on the `/sign-in` prefix. `/passkey/*` mints
     * sessions and does not match it, so without these the only session-minting paths in
     * the app would be entirely unlimited — the exact hole the Freighter removal closed by
     * accident and this reopens by design.
     *
     * The verify endpoints are the ones that matter: they are where an attacker would
     * grind. The options endpoints are looser because a challenge is useless without an
     * authenticator, and because a user who taps twice must not be locked out of their own
     * sign-in.
     *
     * `enabled` is left at its default, which is production-only. Turning it on in
     * development would cap sign-in while iterating.
     */
    rateLimit: {
      storage: "database",
      customRules: {
        "/passkey/sign-in-verify": { window: 10, max: 5 },
        "/passkey/sign-up-verify": { window: 60, max: 5 },
        "/passkey/sign-in-options": { window: 10, max: 10 },
        "/passkey/sign-up-options": { window: 10, max: 10 },
      },
    },

    /**
     * CSRF allowlist. Every origin the app is served from must appear here or sign-in
     * fails — silently, and in Safari first, because ITP is stricter than Chrome about
     * anything that looks cross-site.
     *
     * Auth runs same-origin through the Next.js `/api/auth/*` proxy, so in practice this
     * is the web app's own origin per environment.
     */
    trustedOrigins: trustedOrigins(),

    // `authConfig` is required — it's how Convex learns to validate the JWTs this
    // issues, which is what makes ctx.auth.getUserIdentity() work.
    //
    // `passkeyAuth` is the only way a session is ever minted now. It takes `ctx` because
    // its endpoints reach the WebAuthn cryptography by `runAction` into a "use node"
    // module — this runtime cannot load it directly.
    plugins: [convex({ authConfig }), passkeyAuth(ctx)],
  });

function trustedOrigins(): string[] {
  const origins = new Set<string>(["http://localhost:3000"]);

  // The deployed origin, whatever it is for this environment.
  if (process.env.SITE_URL) origins.add(process.env.SITE_URL);

  // Vercel preview deployments get a fresh hostname per build, so they cannot be
  // enumerated ahead of time.
  origins.add("https://*.vercel.app");

  return [...origins];
}

/**
 * An address a human actually chose, or null for the synthetic one a passkey user gets.
 *
 * `@passkey.invalid` addresses exist only because Better Auth requires a unique email per
 * user; they are derived from a credential id and mean nothing to anyone. Anywhere an
 * address would be *shown* or turned into a name, this is the filter.
 */
function realEmail(email: string | undefined | null): string | null {
  const trimmed = email?.trim();
  if (!trimmed || trimmed.endsWith("@passkey.invalid")) return null;
  return trimmed;
}

/** A name to show. Falls back to the email local-part rather than rendering "undefined". */
function displayName(name: string | undefined | null, email: string | undefined | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = realEmail(email)?.split("@")[0]?.trim();
  return local || "Curator";
}

/**
 * A handle that is actually free.
 *
 * `by_handle` is an index, not a uniqueness constraint — Convex has none — so collisions
 * are ours to prevent. This runs inside the mutation that inserts the row, and Convex
 * mutations are serializable transactions, so the check and the insert cannot interleave
 * with another signup.
 */
async function uniqueHandle(ctx: MutationCtx, seed: string): Promise<string> {
  const base =
    (seed.split("@")[0] ?? seed)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 20) || "curator";

  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    const taken = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", candidate))
      .unique();
    if (!taken) return candidate;
  }

  // 100 collisions on one base means something is wrong, but failing signup outright is
  // worse than an ugly handle.
  return `${base}${Date.now().toString(36)}`;
}
