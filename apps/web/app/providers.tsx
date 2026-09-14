"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { authClient } from "@/lib/auth-client";

/**
 * Convex + Better Auth providers.
 *
 * `ConvexBetterAuthProvider` keeps the Convex client's auth token in sync with the Better
 * Auth session, which is what makes `ctx.auth.getUserIdentity()` work inside every Convex
 * function. Without it, queries run as an anonymous caller and every guard in
 * convex/model/auth.ts rejects — usually presenting as "Not signed in" while the UI
 * clearly shows a signed-in user.
 *
 * ── Why `expectAuth` is NOT set ───────────────────────────────────────────────────────
 * It used to be, to stop a signed-in user seeing a flash of signed-out UI while the token
 * resolved. It cannot be used in this app, and the failure mode is total rather than
 * cosmetic:
 *
 * `expectAuth: true` pauses the websocket in the ConvexReactClient constructor, and the
 * only thing that resumes it is the end of the auth manager's `setConfig()` — which runs
 * only when `client.setAuth()` is called. `ConvexProviderWithAuth` calls `setAuth()` only
 * when the auth provider already reports an authenticated user; for a signed-out visitor
 * it calls neither, so the socket stays paused forever and *every* query — public ones
 * included — hangs at `undefined`. That is indistinguishable from a slow network, so it
 * presents as a page of loading skeletons that never resolve.
 *
 * That is fine for an app where every page requires a session. This one has public pages
 * (`/app/community`) and a sign-in prompt that only renders once we know the visitor is
 * signed out, so it is not that app.
 *
 * The flash it was guarding against is handled properly instead, in
 * `components/musea/require-auth.tsx`: gate on `useConvexAuth()`, whose `isLoading` comes
 * from the auth provider rather than from a query, so "still checking" and "definitely
 * signed out" stay distinguishable without pausing anything.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Copy apps/web/.env.local.example to " +
      ".env.local and fill it in — `pnpm --filter @musea/backend dev` prints the URL.",
  );
}

const convex = new ConvexReactClient(convexUrl);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // This cast is upstream's problem, and it is narrower than an earlier note here claimed.
    //
    // `AuthClient` in @convex-dev/better-auth@0.12.5 is declared as
    // `ReturnType<typeof createAuthClient<BetterAuthClientPlugin & { plugins: Plugins }>>`.
    // Passing a plugin type where an options object belongs collapses the session
    // inference, so the declared prop type resolves to `useSession().data: never` — which
    // no real client can satisfy, because `null` is not assignable to `never`. Our client
    // is strictly *more* specific than the prop demands, not less.
    //
    // So this is not the "client isn't generic over the server config" problem the previous
    // comment guessed at; making the client generic does not fix it. Re-check on the next
    // component bump and drop the cast the moment `AuthClient` stops resolving to `never`.
    //
    // It also does NOT leave session types unusable elsewhere: `authClient.useSession()`
    // imported straight from `@/lib/auth-client` is fully typed (user id, email, name,
    // image, session). Only this one prop boundary needs coercing.
    <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
