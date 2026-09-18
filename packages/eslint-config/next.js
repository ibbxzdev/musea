import { baseConfig } from "./base.js";

/**
 * Flat config for the Next.js web app.
 *
 * The important rule here is the `no-restricted-imports` block. The golden rule of this
 * project (see docs/architecture.md) is that no blockchain code
 * runs in the browser: every Stellar operation happens inside a Convex Node action.
 * If a Stellar package ever lands in the client bundle we have shipped hundreds of KB
 * to a phone for nothing — and, far worse, moved key-adjacent code next to the client.
 * This rule makes that a build failure rather than a code-review catch.
 */
export const nextConfig = [
  ...baseConfig,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@stellar/stellar-sdk",
              message:
                "Stellar code must never run in the browser. Call a Convex action in packages/backend/convex/stellar/ instead.",
            },
            {
              name: "@stellar/stellar-base",
              message:
                "Stellar code must never run in the browser. Call a Convex action in packages/backend/convex/stellar/ instead.",
            },
            {
              name: "stellar-sdk",
              message:
                "Stellar code must never run in the browser. Call a Convex action in packages/backend/convex/stellar/ instead.",
            },
            {
              // Not a `@stellar/*` package, so the pattern below does not catch it — but its
              // entry point re-exports `BASE_FEE` from @stellar/stellar-sdk and it depends on
              // the SDK outright, so importing any of it here drags the whole Stellar bundle
              // into the browser. Only the kit's WebAuthn half belongs on the client, and
              // that half is `@simplewebauthn/browser`, which this rule deliberately allows.
              name: "smart-account-kit",
              message:
                "smart-account-kit pulls in @stellar/stellar-sdk. The browser's only job is WebAuthn: import @simplewebauthn/browser and let the Convex action in packages/backend/convex/stellar/ drive the kit.",
            },
          ],
          patterns: [
            {
              group: ["@stellar/*", "smart-account-kit/*"],
              message:
                "Stellar code must never run in the browser. Call a Convex action in packages/backend/convex/stellar/ instead.",
            },
          ],
        },
      ],
    },
  },
];

export default nextConfig;
