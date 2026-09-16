"use client";

import { ConvexError } from "convex/values";
import { PasskeyError } from "./passkey";

/**
 * Error diagnostics for a device with no console attached.
 *
 * On an iPhone there is no console to open, and the failures that matter here happen in
 * three different places that all end up saying the same thing to the user:
 *
 *   - **In the browser**, as a `DOMException` from `navigator.credentials` — where the
 *     `name` is the whole diagnosis and the `message` is often empty.
 *   - **In a Convex action**, arriving as a `ConvexError` whose `message` is deliberately
 *     a sentence for users; the real text rides along in `data.debug`.
 *   - **Between the two**, as a transport failure that never reached Convex at all and
 *     therefore has no code — the case the UI is most likely to misreport as a backend
 *     bug, because it looks identical from the toast.
 *
 * `describeError` keeps all three distinguishable. Nothing here is written for users —
 * `userMessageFor` still owns that — this is what gets read aloud over a call or pasted
 * into an issue.
 */

/**
 * Everything known about a failure, as one string.
 *
 * Deliberately not pretty. The first line is the classification, the rest is whatever the
 * error carried, and none of it is truncated in the middle of a value — a half-printed
 * contract address has cost more time here than a long line ever has.
 */
export function describeError(error: unknown): string {
  const lines: string[] = [];

  if (error instanceof PasskeyError) {
    lines.push(`PasskeyError: ${error.code}`);
    // The DOMException `classify()` folded into that code. Its `name` is the real
    // diagnosis on iOS — `NotAllowedError` alone separates "user cancelled" from "this
    // domain has no such credential", which are the two likeliest passkey faults.
    const cause = (error as { cause?: unknown }).cause;
    if (cause) lines.push(`  from ${describeRaw(cause)}`);
  } else if (error instanceof ConvexError) {
    const data = error.data as { code?: string; message?: string; debug?: string } | undefined;
    lines.push(`ConvexError: ${data?.code ?? "no code"}`);
    if (data?.message) lines.push(`  ${data.message}`);
    // Only present while DEBUG_ERRORS is on server-side. Its absence is itself a signal:
    // it means the failure never reached one of our classified catch blocks.
    if (data?.debug) lines.push(data.debug);
  } else {
    lines.push(describeRaw(error));
  }

  return lines.join("\n");
}

function describeRaw(error: unknown): string {
  if (error instanceof Error) {
    const extras = (["name", "code", "status", "type"] as const)
      .map((key) => (error as unknown as Record<string, unknown>)[key])
      .filter(Boolean);
    return `${error.name}: ${error.message || "(no message)"}${
      extras.length > 1 ? ` [${extras.join(", ")}]` : ""
    }`;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Describe a failure, and put it in the console too.
 *
 * The console copy carries the live error object rather than the string, so Safari's
 * inspector can expand it when a Mac is actually attached. `scope` names the call that
 * failed — grep for `[musea]` to see only these.
 */
export function logError(scope: string, error: unknown): string {
  const described = describeError(error);
  console.error(`[musea] ${scope}\n${described}`, error);
  return `${scope}\n${described}`;
}
