import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat config for every TypeScript package in the repo. */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".next/**",
      ".turbo/**",
      "target/**",
      "**/_generated/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];

export default baseConfig;
