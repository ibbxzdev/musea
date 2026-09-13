import { baseConfig } from "./base.js";

/**
 * Flat config for the Next.js web app.
 *
 * The important rule here is the `no-restricted-imports` block. The golden rule of this
 * project (see docs/Musea_Stellar_Implementation_Spec.md) is that no blockchain code
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
          ],
          patterns: [
            {
              group: ["@stellar/*"],
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
