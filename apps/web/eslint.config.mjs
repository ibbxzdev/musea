import { nextConfig } from "@musea/eslint-config/next";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
];
