import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

/**
 * Convex HTTP routes.
 *
 * `registerRoutes` mounts Better Auth's handler at `/api/auth/*` on the deployment's
 * `.convex.site` origin. This file is not optional scaffolding: `auth.config.ts` points
 * Convex at `${CONVEX_SITE_URL}/api/auth/convex/jwks` for the key set it validates tokens
 * with, and that route exists only because of this call. Without it, sign-in appears to
 * work in the browser while every Convex function still sees an anonymous caller.
 *
 * The web app reaches these through the same-origin Next.js proxy at
 * `apps/web/app/api/auth/[...all]/route.ts` rather than calling `.convex.site` directly —
 * see the note there about Safari and third-party cookies.
 */

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

export default http;
