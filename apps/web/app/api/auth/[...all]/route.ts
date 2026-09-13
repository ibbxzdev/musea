import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

/**
 * Better Auth HTTP handler.
 *
 * Auth runs same-origin (/api/auth/*) rather than cross-site on purpose: Safari's
 * Intelligent Tracking Prevention is aggressive about third-party cookies, and a
 * cross-site auth setup that works in Chrome can fail silently on an iPhone — which is
 * the exact device this project is verified on.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

if (!convexUrl || !convexSiteUrl) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CONVEX_SITE_URL must both be set. " +
      "The site URL is the .convex.site origin (not .convex.cloud).",
  );
}

export const { handler } = convexBetterAuthNextJs({ convexUrl, convexSiteUrl });

export const { GET, POST } = handler;
