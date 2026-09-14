"use client";

import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

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
  plugins: [convexClient()],
});
