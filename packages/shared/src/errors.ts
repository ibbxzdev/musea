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
  | "DUPLICATE_TIP"
  | "CONTRACT_NOT_INITIALIZED"
  | "OVERFLOW"
  | "NETWORK_MISCONFIGURED"
  | "CURATOR_NOT_FUNDED"
  | "CURATOR_NOT_CONNECTED"
  | "SIGNATURE_REJECTED"
  | "TRANSACTION_MISMATCH"
  // ── Passkey smart accounts (Story 2B.4) ─────────────────────────────────────────────
  //
  // Failure modes that did not exist under custody, because under custody nothing about
  // signing could fail in the user's hands. Each of these is something the *device* did.
  | "PASSKEY_UNSUPPORTED"
  | "PASSKEY_NOT_REGISTERED"
  | "PASSKEY_RP_MISMATCH"
  | "PASSKEY_PROVISIONING_FAILED"
  | "PASSKEY_AUTH_REJECTED"
  | "CHALLENGE_MISMATCH"
  // ── Gasless submission ──────────────────────────────────────────────────────────────
  //
  // Kept distinct from contract failures on purpose: a tip that never reached the network
  // is a retry, a tip the contract rejected is not, and wording them alike trains people
  // to retry the one thing that will never succeed.
  | "RELAYER_UNAVAILABLE"
  | "RELAYER_REJECTED"
  | "UNKNOWN";

/** Contract error variants, mirroring the `Error` enum in contracts/tipjar/src/lib.rs. */
export const CONTRACT_ERRORS = {
  1: "NotInitialized",
  2: "InvalidAmount",
  3: "SelfTip",
  4: "Overflow",
} as const;

/**
 * Stellar Asset Contract error variants seen through a contract call.
 *
 * This matters more than it looks. Our XLM transfer happens *inside* TipJar via the SAC,
 * so token failures surface as `Error(Contract, #N)` from the SAC — not as the classic
 * operation codes (`op_no_trust`, `op_underfunded`) that a direct payment would produce.
 * A classifier that only knows the classic codes reports UNKNOWN for the two most common
 * real failures.
 *
 * These numbers are the SAC's own error enum, confirmed against testnet rather than read
 * off a table: #13 is what a missing recipient trustline actually returned during the
 * Epic 1 rehearsal against the deployed contract.
 */
export const SAC_ERRORS = {
  10: "BalanceError",
  13: "TrustlineMissing",
} as const;

const USER_MESSAGES: Record<TipErrorCode, string> = {
  // No longer "try again in a moment": tips go to the curator's own wallet, so nothing we
  // do on the server can make them ready. Only the curator can, and the message says so.
  NO_TRUSTLINE: "This curator can't receive tips right now.",
  CURATOR_NOT_CONNECTED: "This curator hasn't connected a wallet yet, so they can't be tipped.",
  INSUFFICIENT_BALANCE: "Not enough balance.",
  BAD_SEQUENCE: "That didn't go through. Please try again.",
  SIMULATION_FAILED: "That tip couldn't be processed.",
  ACCOUNT_NOT_FUNDED: "Your wallet is still being set up. Try again in a moment.",
  SELF_TIP: "You can't tip your own gallery.",
  // Covers both halves of what `toStroops` rejects: non-positive amounts and more than
  // 7 decimal places. "Greater than zero" alone left the decimal case reading as a lie.
  INVALID_AMOUNT: "Enter a valid amount — more than zero, up to 7 decimal places.",
  TIMEOUT: "Still confirming — check your Activity in a moment.",
  DUPLICATE_TIP: "That tip is already going through — check your Activity.",
  CONTRACT_NOT_INITIALIZED: "Tipping is temporarily unavailable.",
  OVERFLOW: "That amount is too large.",
  NETWORK_MISCONFIGURED: "Tipping is temporarily unavailable.",
  // The curator has an address but nothing has ever reached it. XLM needs no trustline, so
  // a smart account can always receive — this is only reachable for a classic destination.
  CURATOR_NOT_FUNDED: "This curator's wallet isn't set up on Stellar testnet yet.",
  // Not really an error — the user dismissed Face ID. The UI dismisses rather than showing
  // this, but a message exists so nothing renders blank.
  SIGNATURE_REJECTED: "Tip cancelled.",

  // ── Passkey ─────────────────────────────────────────────────────────────────────────
  // Old iOS, or an in-app browser (Instagram, TikTok) that does not expose WebAuthn. The
  // user cannot fix the browser they are in, so the message names the way out.
  PASSKEY_UNSUPPORTED: "This browser can't create a passkey. Open Musea in Safari or Chrome.",
  // No account yet, or the credential lives on a different device. Offer the way forward
  // rather than dead-ending: creating a wallet is one tap.
  PASSKEY_NOT_REGISTERED: "Set up your wallet to tip — it takes one tap and Face ID.",
  // The credential was created for another domain, so the device will not surface it. This
  // is a dev-vs-production mix-up in practice and should never reach a user in production.
  PASSKEY_RP_MISMATCH: "This wallet belongs to a different site. Set one up here to continue.",
  PASSKEY_PROVISIONING_FAILED: "Couldn't finish setting up your wallet. Please try again.",
  // The device produced a signature the smart account's __check_auth refused. Genuinely
  // shouldn't happen; if it does it is ours to fix, so it does not ask the user to retry
  // forever.
  PASSKEY_AUTH_REJECTED: "That signature wasn't accepted. Please try setting up your wallet again.",
  // The assertion answers a different challenge than the one we issued — a stale sheet, or
  // two tips raced. Retrying regenerates the challenge, so retrying is the right advice.
  CHALLENGE_MISMATCH: "That tip expired before it was signed. Please try again.",

  // ── Gasless submission ──────────────────────────────────────────────────────────────
  // Musea pays the fees, so both of these are our problem, not the user's wallet's, and
  // neither should suggest they are out of funds.
  RELAYER_UNAVAILABLE: "Can't reach the network right now. Please try again in a moment.",
  RELAYER_REJECTED: "That tip couldn't be submitted. Please try again.",
  // The envelope coming back is not the one we built. Either something rewrote it in
  // transit or the wallet signed a different transaction; either way we do not submit it.
  TRANSACTION_MISMATCH: "That tip couldn't be verified. Please try again.",
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

  // Our own guards first — they are exact strings, not pattern-matched protocol output.
  if (text.includes("duplicate_pending_tip")) return "DUPLICATE_TIP";

  // Contract errors next, because they are the most specific thing in the text. A
  // simulation failure carrying `Error(Contract, #3)` is a self-tip, and saying so beats
  // reporting the generic "simulation failed" that the substring check further down would
  // otherwise win with.
  //
  // Two numbering schemes overlap here and must not be conflated: #1-#4 are TipJar's own
  // (contracts/tipjar/src/lib.rs), while #10/#13 come from the SAC beneath it. TipJar's
  // are fixed on a deployed contract and must never be renumbered.
  if (text.includes("selftip") || text.includes("error(contract, #3)")) return "SELF_TIP";
  if (text.includes("invalidamount") || text.includes("error(contract, #2)")) {
    return "INVALID_AMOUNT";
  }
  if (text.includes("notinitialized") || text.includes("error(contract, #1)")) {
    return "CONTRACT_NOT_INITIALIZED";
  }
  if (text.includes("overflow") || text.includes("error(contract, #4)")) return "OVERFLOW";

  // SAC errors, raised by the token when the transfer inside `tip` cannot happen. These
  // are the contract-side equivalents of op_no_trust and op_underfunded — the transfer is
  // a cross-contract call, so the classic operation codes never appear.
  if (
    text.includes("op_no_trust") ||
    text.includes("trustline") ||
    text.includes("error(contract, #13)")
  ) {
    return "NO_TRUSTLINE";
  }
  if (
    text.includes("op_underfunded") ||
    text.includes("insufficient balance") ||
    text.includes("error(contract, #10)")
  ) {
    return "INSUFFICIENT_BALANCE";
  }

  if (text.includes("tx_bad_seq")) return "BAD_SEQUENCE";
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
    // `JSON.stringify` returns undefined — not a string — for undefined, functions and
    // symbols. This function is called from inside `catch` blocks, so returning that
    // would make the error handler itself throw, masking the original failure and
    // skipping the "record this tip as failed" step that follows it.
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** Horizon attaches result codes to a `response.data.extras` blob rather than the message. */
function errorExtras(err: Error): unknown {
  const maybe = err as Error & { response?: { data?: { extras?: unknown } } };
  return maybe.response?.data?.extras ?? {};
}
