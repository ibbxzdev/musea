/**
 * XLM amount conversions.
 *
 * The spec calls this the #1 source of bugs in the project, so it lives in one place,
 * is used by both the web app and the Convex backend, and is covered by tests.
 *
 * Two representations exist and they are NOT interchangeable:
 *
 *  - **Display / classic**: a decimal string with exactly 7 decimal places, e.g. "5.0000000".
 *    This is what classic Stellar operations (payment, changeTrust) take.
 *  - **Stroops**: an integer, where 1 XLM = 10,000,000. This is the `i128` the Soroban
 *    contract takes.
 *
 * Stroops are modelled as `bigint`, never `number`. A JS number holds integers exactly
 * only up to 2^53-1; that is about 900 million XLM, which is fine today but the failure
 * mode is silent corruption rather than an error, so we don't rely on it.
 *
 * The 7-decimal scale is a property of the Stellar protocol, not of a particular asset —
 * it is the same for XLM and for any issued asset. Only the naming here is asset-specific.
 */

/** Decimal places for a classic Stellar asset. Fixed by the protocol — not a preference. */
export const STROOP_DECIMALS = 7 as const;

/** 1 XLM expressed in stroops. */
export const STROOPS_PER_XLM = 10_000_000n;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Convert a user-facing XLM amount to stroops for the contract call.
 *
 * Accepts a string (preferred — no float involved) or a number (convenient for UI presets).
 * Rejects anything that would silently lose money: NaN, Infinity, negatives, or more than
 * 7 decimal places.
 */
export function toStroops(xlm: string | number): bigint {
  const raw = typeof xlm === "number" ? numberToDecimalString(xlm) : xlm.trim();

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new AmountError(`Not a valid XLM amount: ${JSON.stringify(xlm)}`);
  }

  const [whole = "0", fraction = ""] = raw.split(".");

  if (fraction.length > STROOP_DECIMALS) {
    throw new AmountError(
      `XLM supports ${STROOP_DECIMALS} decimal places; got ${fraction.length} in "${raw}". ` +
        `Round before converting — truncating here would silently change the amount.`,
    );
  }

  const padded = fraction.padEnd(STROOP_DECIMALS, "0");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(padded || "0");
}

/**
 * Convert stroops back to the 7-decimal string classic Stellar operations expect,
 * e.g. 50000000n -> "5.0000000".
 */
export function fromStroops(stroops: bigint): string {
  if (stroops < 0n) throw new AmountError(`Negative stroops: ${stroops}`);
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  return `${whole}.${fraction.toString().padStart(STROOP_DECIMALS, "0")}`;
}

/**
 * Human-readable amount for the UI, e.g. 50000000n -> "5" and 51000000n -> "5.1".
 * Trailing zeros are dropped because "5.0000000 XLM" reads like a machine wrote it.
 */
export function formatXlm(stroops: bigint): string {
  const fixed = fromStroops(stroops);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** True when `balance` covers `amount`. Both in stroops. */
export function hasSufficientBalance(balance: bigint, amount: bigint): boolean {
  return balance >= amount && amount > 0n;
}

/**
 * Parse a balance string as returned by Horizon (always 7 decimals) into stroops.
 *
 * Horizon returns "0.0000000" for a zero balance. The native balance is the entry with
 * `asset_type: "native"` and is always present on a funded account — unlike an issued
 * asset, which is omitted entirely when there is no trustline. Callers should still
 * default to "0" before calling this, for the account that does not exist at all.
 */
export function parseHorizonBalance(balance: string): bigint {
  return toStroops(balance);
}

/**
 * Render a JS number as a plain decimal string without exponent notation.
 * `(1e-7).toString()` is "1e-7", which the regex above would reject.
 */
function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new AmountError(`Not a finite amount: ${n}`);
  if (n < 0) throw new AmountError(`Negative amount: ${n}`);
  return n.toFixed(STROOP_DECIMALS);
}
