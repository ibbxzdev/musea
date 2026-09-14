"use client";

import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import type { BetterAuthClientPlugin } from "better-auth/client";
import type { stellarWallet } from "@musea/backend/convex/model/walletAuth";

/**
 * Where the browser sends `/api/auth/*` requests.
 *
 * Auth is proxied same-origin by the Next.js route handler, so the correct answer in the
 * browser is always the origin the page was served from. Hardcoding an absolute URL is
 * what breaks deployments: a build with NEXT_PUBLIC_SITE_URL left at its localhost default
 * ships that literal into the bundle, and the deployed site POSTs to the visitor's own
 * machine (ERR_CONNECTION_REFUSED). Pointing previews at the production domain is the same
 * bug wearing a hat — it turns auth cross-origin, which Safari's ITP blocks.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so changing one in Vercel does nothing
 * until you redeploy.
 *
 * Note this has no bearing on the passkey Relying Party ID (Story 2.1). That is fixed by
 * the hostname the page is served from, not by this value — previews still cannot share
 * credentials with production, and the demo domain still has to be pinned up front.
 */
function resolveBaseURL(): string | undefined {
  // The browser: same-origin by construction, correct on localhost, previews and prod.
  if (typeof window !== "undefined") return window.location.origin;

  // Below here we are prerendering on the server, where there is no origin to read.

  // An explicit pin, if someone set one.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;

  // Vercel's per-deployment hostname, which carries no protocol. Requires "Automatically
  // expose System Environment Variables" (on by default).
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  // Let Better Auth apply its own default rather than inventing one.
  return undefined;
}

/**
 * Client half of the Stellar wallet sign-in plugin.
 *
 * Purely a type carrier and a route table — there is no logic here, and deliberately so.
 * `$InferServerPlugin` imports the *type* of the server plugin, which is what gives
 * `authClient.stellar.nonce()` and `.verify()` their argument and return types; `import
 * type` means nothing from the backend reaches the bundle at runtime.
 *
 * The paths mirror the endpoints in packages/backend/convex/model/walletAuth.ts. Better
 * Auth turns each path segment into a nested property, so `/stellar/nonce` is reached as
 * `authClient.stellar.nonce`.
 */
const stellarWalletClient = () =>
  ({
    id: "stellar-wallet",
    $InferServerPlugin: {} as ReturnType<typeof stellarWallet>,
    pathMethods: {
      "/stellar/nonce": "POST",
      "/stellar/verify": "POST",
    },

    /**
     * Tell the client that `/stellar/verify` starts a session.
     *
     * Without this, wallet sign-in sets the cookie and then appears to do nothing: the
     * server is satisfied, but `useSession()` goes on returning null until something
     * reloads the page. Anything gated on the session — the redirect on the sign-in page,
     * and the Convex token that `convexClient()` mints from it — waits forever.
     *
     * The reason is that Better Auth decides when to refetch the session from a fixed list
     * of *exact* paths (`/sign-in/email`, `/sign-up/email`, `/sign-out`, ...) in
     * `client/config.mjs`. It is equality, not a prefix match, and there is no hook for
     * "this endpoint authenticated someone" — so every plugin that mints a session has to
     * say so here. better-auth's own admin plugin does exactly this for
     * `/admin/impersonate-user`, which changes the session without being a sign-in path.
     *
     * `/stellar/nonce` is deliberately absent: it issues a challenge and changes nothing
     * about who the caller is.
     */
    atomListeners: [
      {
        matcher: (path: string) => path === "/stellar/verify",
        signal: "$sessionSignal",
      },
    ],
  }) satisfies BetterAuthClientPlugin;

/**
 * Better Auth browser client.
 *
 * The `convexClient()` plugin is what lets ConvexBetterAuthProvider mint Convex tokens
 * from the Better Auth session — without it the app authenticates against Better Auth but
 * every Convex function still sees an anonymous caller.
 *
 * Every origin this is served from must also appear in Better Auth's `trustedOrigins`
 * (packages/backend/convex/auth.ts), or sign-in fails the CSRF check — silently, and in
 * Safari first.
 */
export const authClient = createAuthClient({
  baseURL: resolveBaseURL(),
  plugins: [convexClient(), stellarWalletClient()],
});

/**
 * Leave the app after signing out or deleting the account — as a full page load.
 *
 * **Not `router.push`.** A Next soft navigation keeps the whole client alive across the
 * transition, and three pieces of it outlive a sign-out:
 *
 *   1. **The Convex client's token.** Clearing a cookie does not invalidate a JWT that has
 *      already been minted and handed to the socket. `useConvexAuth()` goes on reporting
 *      `isAuthenticated`, so `RequireAuth` keeps letting the user through and queries keep
 *      answering — the app genuinely still looks signed in.
 *   2. **The session atom.** `signOut()` fires `$sessionSignal`, but the refetch that
 *      clears `useSession()` is asynchronous and has not landed yet.
 *   3. **The Convex query cache.** `useQuery(api.users.viewer)` holds its previous value.
 *
 * Land on `/sign-in` with 2 and 3 still stale and its redirect effect reads
 * `session && viewer` as true and bounces straight back to `/app` — which forwards to
 * `/app/artifacts`. Signing out then looks like being thrown into the app still signed in.
 *
 * A document load is not a tidier version of the same thing; it is the only way to
 * guarantee all three are gone, because it throws away the JavaScript heap that holds
 * them. Correct by construction rather than by winning a race.
 *
 * `replace`, not `assign`: Back should not return to a page rendered for a session that no
 * longer exists.
 */
export function leaveAuthenticatedApp(to = "/sign-in"): void {
  window.location.replace(to);
}
