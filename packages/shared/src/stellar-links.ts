/**
 * Stellar Expert deep links.
 *
 * Every tip receipt in the UI links here — it is how a non-technical reviewer verifies
 * the deliverable, so these must be correct and must point at the same network the
 * backend is actually submitting to.
 */

export type StellarNetwork = "testnet" | "public";

const BASE = "https://stellar.expert/explorer";

export function txUrl(txHash: string, network: StellarNetwork = "testnet"): string {
  return `${BASE}/${network}/tx/${txHash}`;
}

export function accountUrl(publicKey: string, network: StellarNetwork = "testnet"): string {
  return `${BASE}/${network}/account/${publicKey}`;
}

export function contractUrl(contractId: string, network: StellarNetwork = "testnet"): string {
  return `${BASE}/${network}/contract/${contractId}`;
}

/** Shorten a G.../C.../hash for display, e.g. "GABC…WXYZ". */
export function shorten(value: string, lead = 4, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
