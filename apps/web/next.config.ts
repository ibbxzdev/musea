import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript (no build step), so Next compiles them.
  transpilePackages: ["@musea/shared", "@musea/backend"],

  typedRoutes: true,

  images: {
    /**
     * Placeholder thumbnails for the Musea browse UI fixtures. Real saves will be served
     * from Convex file storage, at which point this entry goes away rather than growing.
     */
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },

  /**
   * Keeping Stellar out of the browser bundle.
   *
   * This was originally a `webpack` resolve.alias that mapped @stellar/* to false. That is
   * removed: Next 16 uses Turbopack by default, ignores the webpack hook, and then fails
   * the build outright for having a webpack config with no Turbopack config. It bought
   * nothing and cost the build.
   *
   * The actual guard is `no-restricted-imports` in @musea/eslint-config/next, which runs
   * regardless of bundler. If you want a post-build assertion too, grep the client chunks
   * in CI:
   *
   *   ! grep -rl "stellar" .next/static/chunks
   */
};

export default nextConfig;
