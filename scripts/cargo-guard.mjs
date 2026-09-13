#!/usr/bin/env node
/**
 * Runs a cargo subcommand, degrading gracefully when Rust is not installed.
 *
 * Why this exists: most work in this repo is TypeScript, and someone touching only the web
 * app should not need a Rust toolchain to run `pnpm check`. But silently skipping the
 * contract's tests everywhere would mean a broken contract sails through CI.
 *
 * So: missing cargo is a loud warning locally, and a hard failure in CI.
 *
 * Usage: node ../../scripts/cargo-guard.mjs <cargo args...>
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isCI = process.env.CI === "true" || process.env.CI === "1";

const probe = spawnSync("cargo", ["--version"], { stdio: "ignore", shell: true });
const cargoMissing = probe.error != null || probe.status !== 0;

if (cargoMissing) {
  const message =
    `cargo not found — skipping \`cargo ${args.join(" ")}\`.\n` +
    `   The TipJar contract is NOT being checked. Install Rust to build it:\n` +
    `     https://rustup.rs   then: cargo install --locked stellar-cli\n` +
    `   See docs/stories/epic-0-foundation.md, Story 0.1.`;

  if (isCI) {
    console.error(`error: ${message}`);
    console.error("   Failing because CI is set: the contract must be verified in CI.");
    process.exit(1);
  }

  console.warn(`warning: ${message}`);
  process.exit(0);
}

const result = spawnSync("cargo", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
