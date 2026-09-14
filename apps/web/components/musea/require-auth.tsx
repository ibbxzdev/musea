"use client";

import { useConvexAuth } from "convex/react";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

/**
 * Gate for the sections that are somebody's own library.
 *
 * Deliberately client-side and per-section rather than a middleware redirect: Community
 * is readable signed out, and a redirect in the layout would take a visitor following a
 * shared gallery link straight to a sign-in form.
 *
 * Gated on `useConvexAuth()` rather than on `useQuery(api.users.viewer)`, for two reasons:
 *
 *   1. `isLoading` comes from the auth provider, not from a query, so "still checking" and
 *      "definitely signed out" stay distinguishable. A viewer query cannot tell those
 *      apart before it resolves, which is what makes the sign-in prompt flash for a user
 *      who is in fact signed in.
 *   2. It holds the children back until the token is on the socket, so the authenticated
 *      queries inside them never fire as an anonymous caller and get rejected by the
 *      guards in convex/model/auth.ts.
 *
 * See the note in app/providers.tsx for why this is the job of a hook here rather than of
 * `expectAuth` on the client.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-11 w-full max-w-md animate-pulse rounded-full bg-muted" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        icon={LogIn}
        title="Sign in to Musea"
        description="Your artifacts and galleries live with your account."
        action={
          <Button asChild className="h-11 rounded-full px-6">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
}
