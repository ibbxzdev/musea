"use client";

import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth browser client.
 *
 * The `convexClient()` plugin is what lets ConvexBetterAuthProvider mint Convex tokens
 * from the Better Auth session — without it the app authenticates against Better Auth but
 * every Convex function still sees an anonymous caller.
 *
 * TODO (Story 0.3): confirm baseURL handling for Vercel preview deployments. Preview URLs
 * are per-deployment, so either set NEXT_PUBLIC_SITE_URL per environment or derive it from
 * VERCEL_URL — and remember every origin must also be in Better Auth's trustedOrigins,
 * or sign-in fails (Safari most strictly).
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_SITE_URL,
  plugins: [convexClient()],
});
