import type { AuthConfig } from "convex/server";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";

/**
 * Convex auth provider config.
 *
 * This is what tells Convex how to validate the JWTs Better Auth issues, and is therefore
 * what makes `ctx.auth.getUserIdentity()` return a real identity rather than null. Every
 * guard in convex/model/auth.ts depends on it.
 *
 * `JWKS` is optional but worth setting: without it, Convex fetches the key set from the
 * database on token validation. With it, the keys are read straight from an env var.
 *
 *   npx convex run auth:generateJwk | npx convex env set JWKS
 *
 * Run that once Story 0.3's auth wiring is in place (the `generateJwk` function comes from
 * the Better Auth component).
 */
export default {
  providers: [getAuthConfigProvider({ jwks: process.env.JWKS })],
} satisfies AuthConfig;
