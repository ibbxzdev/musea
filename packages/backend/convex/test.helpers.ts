/**
 * Module map for convex-test.
 *
 * `import.meta.glob` has to appear literally in a file Vite processes, so it lives here
 * rather than being built per test file.
 *
 * The `*Node.ts` exclusion is not tidiness. convex-test cannot execute `"use node"`
 * modules at all, and merely loading them here would pull `@stellar/stellar-sdk` and
 * `node:crypto` into the edge-runtime test environment and fail before a single assertion
 * ran. Those modules are verified against real testnet instead; what these tests cover is
 * the isolate-runtime half, which is deliberately where the auth guards live.
 */

declare global {
  /**
   * `import.meta.glob` is a Vite transform rather than standard TypeScript, and `vite` is
   * only a transitive dependency of vitest here — `vite/client` does not resolve from this
   * package. Declaring the single member we use keeps `tsc` honest without taking on a
   * dependency purely for a type.
   */
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

const all = import.meta.glob("./**/*.ts");

export const modules: Record<string, () => Promise<unknown>> = Object.fromEntries(
  Object.entries(all).filter(
    ([path]) =>
      !path.endsWith("Node.ts") && !path.includes(".test.") && !path.includes("test.helpers"),
  ),
);
