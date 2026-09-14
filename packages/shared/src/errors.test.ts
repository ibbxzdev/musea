import { describe, expect, test } from "vitest";
import { classifyStellarError, userMessageFor, type TipErrorCode } from "./errors";

/**
 * The error map (Story 2.4).
 *
 * The case that motivates most of this: our USDC transfer happens *inside* TipJar via the
 * SAC, so token failures arrive as `Error(Contract, #N)` rather than as the classic
 * operation codes (`op_no_trust`, `op_underfunded`) a direct payment would produce. A
 * classifier that only knows the classic codes reports UNKNOWN for the two most common
 * real failures, and the user gets "Something went wrong" instead of "Not enough balance".
 */

describe("contract errors are more specific than the simulation wrapper", () => {
  // Each of these arrives wrapped in "Simulation failed: …", which would otherwise match
  // SIMULATION_FAILED first and throw away the specific reason.
  const cases: [string, TipErrorCode][] = [
    ["Simulation failed: HostError: Error(Contract, #3)", "SELF_TIP"],
    ["Simulation failed: HostError: Error(Contract, #2)", "INVALID_AMOUNT"],
    ["Simulation failed: HostError: Error(Contract, #1)", "CONTRACT_NOT_INITIALIZED"],
    ["Simulation failed: HostError: Error(Contract, #4)", "OVERFLOW"],
    ["Simulation failed: HostError: Error(Contract, #13)", "NO_TRUSTLINE"],
    ["Simulation failed: HostError: Error(Contract, #10)", "INSUFFICIENT_BALANCE"],
  ];

  test.each(cases)("%s -> %s", (text, expected) => {
    expect(classifyStellarError(new Error(text))).toBe(expected);
  });

  test("an unrecognised contract error still reports as a simulation failure", () => {
    expect(classifyStellarError(new Error("Simulation failed: Error(Contract, #999)"))).toBe(
      "SIMULATION_FAILED",
    );
  });
});

describe("classic operation codes still classify", () => {
  test.each([
    ["op_no_trust", "NO_TRUSTLINE"],
    ["op_underfunded", "INSUFFICIENT_BALANCE"],
    ["tx_bad_seq", "BAD_SEQUENCE"],
    ["tx_too_late", "TIMEOUT"],
  ] as [string, TipErrorCode][])("%s -> %s", (text, expected) => {
    expect(classifyStellarError(new Error(`Horizon rejected: ${text}`))).toBe(expected);
  });

  test("Horizon puts result codes in response.data.extras, not the message", () => {
    const err = Object.assign(new Error("Request failed with status code 400"), {
      response: { data: { extras: { result_codes: { operations: ["op_no_trust"] } } } },
    });
    expect(classifyStellarError(err)).toBe("NO_TRUSTLINE");
  });
});

describe("our own guards", () => {
  test("the double-submit guard is its own code", () => {
    expect(classifyStellarError(new Error("DUPLICATE_PENDING_TIP"))).toBe("DUPLICATE_TIP");
  });

  test("a timeout is not reported as a failure", () => {
    // The transaction may still land. Saying "it failed" would be a false statement.
    expect(classifyStellarError(new Error("Timed out awaiting confirmation of abc123"))).toBe(
      "TIMEOUT",
    );
  });

  test("an unknown shape degrades to UNKNOWN rather than throwing", () => {
    expect(classifyStellarError(undefined)).toBe("UNKNOWN");
    expect(classifyStellarError({ weird: Symbol("x") })).toBe("UNKNOWN");
  });
});

describe("every code has a message written for a human", () => {
  const codes: TipErrorCode[] = [
    "NO_TRUSTLINE",
    "INSUFFICIENT_BALANCE",
    "BAD_SEQUENCE",
    "SIMULATION_FAILED",
    "ACCOUNT_NOT_FUNDED",
    "SELF_TIP",
    "INVALID_AMOUNT",
    "TIMEOUT",
    "DUPLICATE_TIP",
    "CONTRACT_NOT_INITIALIZED",
    "OVERFLOW",
    "NETWORK_MISCONFIGURED",
    "UNKNOWN",
  ];

  test.each(codes)("%s", (code) => {
    const message = userMessageFor(code);
    expect(message).toBeTruthy();
    // No XDR, no result codes, no contract error numbers leaking into user-facing text.
    expect(message).not.toMatch(/op_|tx_|Error\(Contract|xdr/i);
  });
});
