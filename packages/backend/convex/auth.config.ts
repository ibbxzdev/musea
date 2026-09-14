import type { AuthConfig } from "convex/server";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";

/**
 * Convex auth provider config.
 *
 * This is what tells Convex how to validate the JWTs Better Auth issues, and is therefore
 * what makes `ctx.auth.getUserIdentity()` return a real identity rather than null. Every
 * guard in convex/model/auth.ts depends on it.
 *
 * With no `jwks` option, the provider points at `${CONVEX_SITE_URL}/api/auth/convex/jwks`
 * and Convex fetches the key set over HTTP. That route is served by `registerRoutes` in
 * convex/http.ts — the two have to stay in step.
 *
 * ── On the JWKS env var ───────────────────────────────────────────────────────────────
 * Passing `{ jwks: process.env.JWKS }` reads the keys straight from an env var and skips
 * that fetch. It is only an optimisation, and it is deliberately NOT used here, because:
 *
 *   - Convex validates this file at push time and refuses to deploy when an env var it
 *     references is unset. The key set does not exist until Better Auth has issued its
 *     first token, so referencing it makes the very first deploy impossible.
 *   - `generateJwk` is not exported by @convex-dev/better-auth 0.12.5 — the component's
 *     docs mention `npx convex run auth:generateJwk` but no such function ships. Adopting
 *     the env var means writing it first.
 *
 * If it ever becomes worth it, add that function, deploy once without this, then set the
 * var and add the option — in that order.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
