import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript (no build step), so Next compiles them.
  transpilePackages: ["@musea/shared", "@musea/backend"],

  typedRoutes: true,

  /**
   * No `images.remotePatterns`, and no `next/image` on artifact thumbnails.
   *
   * A saved artifact's thumbnail is an `og:image` on whatever host the user saved from,
   * so there is no list of hosts to allow — the honest entry would be `hostname: "**"`,
   * and that turns `/_next/image` into an open image proxy: anyone can make this
   * deployment fetch and cache any URL on the internet, on our bandwidth.
   *
   * So artifact media renders through a plain `<img loading="lazy">` (see
   * `components/musea/artifact-card.tsx`). Local static assets still use `next/image`.
   */

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
