/**
 * The error map from §8 of the implementation spec, in one place.
 *
 * Rule: the server logs the detail, the user sees the friendly text. Never surface a raw
 * Horizon/RPC error to the UI — they are XDR-flavoured and meaningless to a reader who
 * just wanted to tip someone a dollar.
 */

export type TipErrorCode =
  | "NO_TRUSTLINE"
  | "INSUFFICIENT_BALANCE"
  | "BAD_SEQUENCE"
  | "SIMULATION_FAILED"
  | "ACCOUNT_NOT_FUNDED"
  | "SELF_TIP"
  | "INVALID_AMOUNT"
  | "TIMEOUT"
  | "NETWORK_MISCONFIGURED"
  | "UNKNOWN";

/** Contract error variants, mirroring the `Error` enum in contracts/tipjar/src/lib.rs. */
export const CONTRACT_ERRORS = {
  1: "NotInitialized",
  2: "InvalidAmount",
  3: "SelfTip",
  4: "Overflow",
} as const;

const USER_MESSAGES: Record<TipErrorCode, string> = {
  NO_TRUSTLINE: "This curator isn't set up to receive tips yet. Try again in a moment.",
  INSUFFICIENT_BALANCE: "Not enough balance.",
  BAD_SEQUENCE: "That didn't go through. Please try again.",
  SIMULATION_FAILED: "That tip couldn't be processed.",
  ACCOUNT_NOT_FUNDED: "Your wallet is still being set up. Try again in a moment.",
  SELF_TIP: "You can't tip your own gallery.",
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  TIMEOUT: "Still confirming — check your Activity in a moment.",
  NETWORK_MISCONFIGURED: "Tipping is temporarily unavailable.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export function userMessageFor(code: TipErrorCode): string {
  return USER_MESSAGES[code];
}

/**
 * Classify a raw error from Horizon, Soroban RPC, or the contract into a code.
 *
 * Matching on substrings is crude, but these result codes are stable parts of the Stellar
 * protocol, and the alternative — decoding result XDR on every failure path — is a lot of
 * machinery for a 30-day scope. Revisit if the mapping ever gets load-bearing.
 */
export function classifyStellarError(err: unknown): TipErrorCode {
  const text = extractText(err).toLowerCase();

  if (text.includes("op_no_trust")) return "NO_TRUSTLINE";
  if (text.includes("op_underfunded") || text.includes("insufficient balance")) {
    return "INSUFFICIENT_BALANCE";
  }
  if (text.includes("tx_bad_seq")) return "BAD_SEQUENCE";
  if (text.includes("selftip") || text.includes("error(contract, #3)")) return "SELF_TIP";
  if (text.includes("invalidamount") || text.includes("error(contract, #2)")) {
    return "INVALID_AMOUNT";
  }
  if (text.includes("tx_too_late") || text.includes("timed out") || text.includes("timeout")) {
    return "TIMEOUT";
  }
  if (text.includes("404") || text.includes("not found")) return "ACCOUNT_NOT_FUNDED";
  if (text.includes("simulation")) return "SIMULATION_FAILED";
  if (text.includes("passphrase") || text.includes("missing env")) return "NETWORK_MISCONFIGURED";

  return "UNKNOWN";
}

function extractText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.message} ${JSON.stringify(errorExtras(err))}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Horizon attaches result codes to a `response.data.extras` blob rather than the message. */
function errorExtras(err: Error): unknown {
  const maybe = err as Error & { response?: { data?: { extras?: unknown } } };
  return maybe.response?.data?.extras ?? {};
}
