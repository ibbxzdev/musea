import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

/**
 * Better Auth, wired through the @convex-dev/better-auth component.
 *
 * Why this component rather than rolling auth ourselves: it makes the Better Auth session
 * and the Convex identity (`ctx.auth.getUserIdentity()`) the same thing. Every guard in
 * convex/model/auth.ts depends on that being true.
 *
 * ── TODO (Story 0.3) ──────────────────────────────────────────────────────────────────
 * This is the shape, not the finished wiring. Before implementing, read:
 *   - the `better-auth-best-practices` skill (server/client config, env vars)
 *   - the `better-auth-security-best-practices` skill (trusted origins, cookies, rate limits)
 *   - https://labs.convex.dev/better-auth for the component's current setup steps
 *
 * Specifically still to do:
 *   1. Decide providers. Email+password is enough for the demo and makes the two-account
 *      recording (tipper + curator) trivial; Google OAuth matches real Musea.
 *   2. Set BETTER_AUTH_SECRET and SITE_URL in the Convex dashboard.
 *   3. Add `trustedOrigins` for localhost + the Vercel preview and production domains.
 *      Getting this wrong shows up as a silent sign-in failure in Safari specifically,
 *      because ITP is stricter than Chrome about cross-site cookies. Keep auth same-site.
 *   4. Register the `onCreateUser` trigger that inserts the matching `users` row, so a
 *      Better Auth user and our profile row are created together rather than drifting.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // testnet demo; revisit before any real launch
    },

    // TODO: add socialProviders.google once GOOGLE_CLIENT_ID/SECRET are set.

    // `authConfig` is required — it's how Convex learns to validate the JWTs this
    // issues, which is what makes ctx.auth.getUserIdentity() work.
    plugins: [convex({ authConfig })],
  });
