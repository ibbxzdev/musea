import { defineConfig } from "vitest/config";

/**
 * convex-test runs the backend against an in-memory Convex, with no deployment and no
 * network.
 *
 * `edge-runtime` rather than `node` on purpose: Convex's default function runtime is an
 * isolate, not Node, so a test run under Node's globals can pass while the real deployment
 * fails on something Node happens to provide. Testing under the stricter environment is
 * the point of running these at all.
 *
 * What this cannot cover: `"use node"` modules. convex-test does not execute them, so
 * `stellar/walletsNode.ts` and `stellar/tipsNode.ts` are out of reach here and are
 * verified against real testnet instead (see docs/stories/epic-2-backend.md). That
 * limitation is exactly why the auth guards were split out into isolate-runtime modules —
 * the rule CLAUDE.md calls non-negotiable is in the half that tests can reach.
 */
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
