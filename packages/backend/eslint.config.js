import { baseConfig } from "@musea/eslint-config/base";

export default [
  ...baseConfig,
  {
    ignores: ["convex/_generated/**"],
  },
];
