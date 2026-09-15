import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import authConfig from "./auth.config";

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
          handle: await uniqueHandle(ctx, authUser.email ?? authUser.name ?? authUser._id),
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

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // testnet demo; revisit before any real launch
    },

    /**
     * Required for `auth.api.deleteUser` in convex/users.ts to do anything. Without it
     * Better Auth refuses the call, and "Delete account" fails after this app's own
     * cascade has already run — leaving an account with nothing in it.
     */
    user: { deleteUser: { enabled: true } },

    /**
     * Rate limiting, with one deliberate departure from the defaults.
     *
     * **storage: "database"**. The default is "memory", which on Convex means a counter
     * living inside one function isolate — isolates come and go per request, so the limit
     * silently does almost nothing. The Better Auth component ships a `rateLimit` table
     * for exactly this; using it is what makes Better Auth's own limits real.
     *
     * There is no longer a custom rule here. One existed for `/stellar/*`, the SEP-0010
     * wallet sign-in endpoints, which minted sessions without matching the `/sign-in`
     * prefix Better Auth's strict 3-per-10s bucket keys on. Those endpoints are gone with
     * the Freighter removal, so email sign-in and sign-up are once again the only
     * session-minting paths and the built-in strict rule covers both.
     *
     * `enabled` is left at its default, which is production-only. Turning it on in
     * development would cap sign-in while iterating.
     */
    rateLimit: {
      storage: "database",
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
    plugins: [convex({ authConfig })],
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

/** A name to show. Falls back to the email local-part rather than rendering "undefined". */
function displayName(name: string | undefined | null, email: string | undefined | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = email?.split("@")[0]?.trim();
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
