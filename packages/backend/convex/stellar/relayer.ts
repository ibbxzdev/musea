"use node";

import { stellarConfig } from "./config";

/**
 * OpenZeppelin Channels — gasless submission (Story 2B.2).
 *
 * Users hold a smart account, not a classic account, and a contract cannot be a
 * transaction's source or pay its fee. Something funded has to supply the source, the
 * sequence number and the fee; Channels does that from a pool of channel accounts, which
 * is what makes a tip cost the user nothing and require no XLM for gas.
 *
 * **Why this is hand-rolled rather than the kit's `RelayerClient`.** The kit posts exactly
 * the body below but sends no `Authorization` header — it is written for a browser talking
 * to a proxy that holds the key. We submit from a Convex action, so the key is already
 * server-side and the proxy is a hop that buys nothing. The wire format is identical, so
 * this can be swapped back for the kit's client the day it grows a header option.
 *
 * The API key is a Convex env var and must never reach the client. It authorises spending
 * someone else's XLM on fees; a leaked key is an open relay, not a data leak.
 */

/** What Channels answers with. `data` is present only on success. */
type ChannelsResponse = {
  success: boolean;
  data?: { hash?: string; status?: string; transactionId?: string } | null;
  error?: string | null;
};

/**
 * Failures Channels reports about itself, as opposed to the contract failing on-chain.
 *
 * Kept distinct because they are not the user's problem and must not be worded as if they
 * were: a tip that never reached the network because the relayer pool was full is a retry,
 * while a tip the contract rejected is not. See the error map's RELAYER_* codes.
 */
export class RelayerError extends Error {
  constructor(
    readonly relayerCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RelayerError";
  }
}

/**
 * Submit a Soroban invocation for fee-sponsored execution.
 *
 * `func` is the base64 host function and `auth` the base64 authorization entries — the two
 * halves of an `invokeHostFunction` operation, already carrying the passkey signature.
 * Channels wraps them in its own envelope, so nothing here supplies a source account and
 * the transaction we simulated is deliberately not the transaction that lands.
 *
 * Returns the confirmed transaction hash. Channels resolves synchronously — its response
 * already reports `status: "confirmed"` — so there is no separate poll here the way there
 * is on the direct-RPC path.
 */
export async function submitViaRelayer(func: string, auth: string[]): Promise<string> {
  const cfg = stellarConfig();

  let response: Response;
  try {
    response = await fetch(cfg.relayerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.relayerApiKey}`,
      },
      body: JSON.stringify({ func, auth }),
    });
  } catch (error) {
    throw new RelayerError(
      "UNREACHABLE",
      `Could not reach the relayer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = (await response.json().catch(() => null)) as ChannelsResponse | null;

  if (!response.ok || !body?.success) {
    // `data.code` is where Channels puts its own classification (INVALID_PARAMS,
    // POOL_CAPACITY, SIMULATION_FAILED, ONCHAIN_FAILED, FEE_LIMIT_EXCEEDED, UNAUTHORIZED).
    const code = (body?.data as { code?: string } | null | undefined)?.code;
    throw new RelayerError(
      code,
      `Relayer rejected the submission (HTTP ${response.status}${code ? `, ${code}` : ""}): ` +
        `${body?.error ?? "no error text"}`,
    );
  }

  const hash = body.data?.hash?.trim();
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    // A success with no usable hash would leave a tip recorded as sent and unverifiable —
    // worse than a visible failure, because the receipt link is the deliverable.
    throw new RelayerError(
      "NO_HASH",
      `Relayer reported success without a transaction hash: ${JSON.stringify(body.data)}`,
    );
  }
  return hash;
}
