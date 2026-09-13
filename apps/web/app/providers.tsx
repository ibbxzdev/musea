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
 * `expectAuth` makes Convex hold queries until the token is known rather than firing an
 * unauthenticated request first, which otherwise causes a visible flash of signed-out UI.
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Copy apps/web/.env.local.example to " +
      ".env.local and fill it in — `pnpm --filter @musea/backend dev` prints the URL.",
  );
}

const convex = new ConvexReactClient(convexUrl, { expectAuth: true });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // KNOWN TYPE GAP (Story 0.3) — this cast is papering over a real error, not a cosmetic one.
    //
    // `ConvexBetterAuthProvider` expects an `AuthClient` whose `useSession().data` is
    // inferred from the SERVER auth config. Our `createAuthClient` call in
    // lib/auth-client.ts has no server type to infer from, so its session type resolves to
    // `never` and the two are structurally incompatible.
    //
    // The fix is to make the client generic over the server config (roughly
    // `createAuthClient<typeof createAuth>(...)`, exact form per
    // https://labs.convex.dev/better-auth) — NOT to keep this cast. Until that is done,
    // `useSession()` gives no useful types anywhere in the app, so do not build session-
    // dependent UI on top of it and assume the types are protecting you.
    <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
