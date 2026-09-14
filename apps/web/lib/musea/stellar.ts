import type { StellarNetwork } from "@musea/shared/stellar-links";

/**
 * Which network every receipt link points at.
 *
 * This deliverable is testnet-only, so testnet is the default and anything else has to be
 * set deliberately. It must match what the backend actually submits to: a link built for
 * the wrong network resolves to "transaction not found" on Stellar Expert, which to a
 * reviewer is indistinguishable from a tip that never happened.
 */
export const STELLAR_NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";
