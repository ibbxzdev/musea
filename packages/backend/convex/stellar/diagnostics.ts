/**
 * Diagnostics — temporary, for the first real-device pass.
 *
 * Every Stellar failure normally leaves as a `ConvexError` carrying a classified code and
 * a sentence written for a human, with the real text going only to `tips.errorDetail`.
 * That is right for users and useless for debugging a device we cannot attach a console
 * to: on an iPhone the whole failure reads "Something went wrong."
 *
 * So this does two things, and both are deliberately loud:
 *
 *   - `diagnosticFor` unwraps the error properly — name, message, the `cause` chain, and
 *     the top stack frames. Most of what breaks here arrives wrapped: an RPC failure
 *     inside a kit error inside ours, where only the innermost layer names the cause.
 *   - `DEBUG_ERRORS` gates whether that text is attached to the `ConvexError` the client
 *     receives. It is server-side text — RPC responses, contract error codes, kit
 *     internals — and it is not written for users.
 *
 * **There is no key material to leak here** (CLAUDE.md rule 3): the signing key lives in
 * the Secure Enclave and this deployment holds no secret but the relayer key, which never
 * appears in an error. What this *does* expose is internal shape. Turn it off for the
 * demo by setting `DEBUG_ERRORS=false` in the Convex environment.
 */

/** Default-on so the first device pass produces something readable without a redeploy. */
export const DEBUG_ERRORS = process.env.DEBUG_ERRORS !== "false";

/** How much of any one error to keep. RPC failures carry very large XDR blobs. */
const MAX_LENGTH = 1500;

/**
 * Everything we know about a failure, as one string.
 *
 * Walks `cause`, because the useful sentence is almost always in the innermost error —
 * `TipError: provisioning failed` tells you nothing, `TypeError: fetch failed` tells you
 * everything. Also picks up the ad-hoc fields the Stellar SDK and the kit hang on their
 * errors instead of putting in the message.
 */
export function diagnosticFor(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current != null; depth++) {
    const prefix = depth === 0 ? "" : "caused by ";

    if (current instanceof Error) {
      parts.push(`${prefix}${current.name}: ${current.message}`);

      const extras = extraFields(current);
      if (extras) parts.push(`  fields: ${extras}`);

      // Only the frames inside our own code are worth the bytes; the rest is node internals.
      const frames = (current.stack ?? "")
        .split("\n")
        .slice(1, 4)
        .map((line) => `  ${line.trim()}`)
        .join("\n");
      if (frames) parts.push(frames);

      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(`${prefix}${safeStringify(current)}`);
      current = undefined;
    }
  }

  return parts.join("\n").slice(0, MAX_LENGTH);
}

/**
 * The non-standard properties errors in this stack actually carry.
 *
 * `SmartAccountError` puts its classification in `code`, the relayer client in
 * `errorCode`, and the Stellar SDK hides simulation failures in `response.data` — none of
 * which reach `message`. Without this, the most common failures print as a bare sentence
 * that names nothing.
 */
function extraFields(error: Error): string | null {
  const candidate = error as unknown as Record<string, unknown>;
  const interesting = ["code", "errorCode", "relayerCode", "status", "type", "data", "response"];

  const found = interesting
    .filter((key) => candidate[key] !== undefined)
    .map((key) => `${key}=${safeStringify(candidate[key]).slice(0, 300)}`);

  return found.length > 0 ? found.join(" ") : null;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Log a failure to the Convex stream and hand back the payload for the `ConvexError`.
 *
 * One call site per catch block, so the logs and what the user is shown cannot drift.
 * `scope` is a stable prefix — grep the Convex logs for `[musea]` to see only these.
 */
export function reportFailure(
  scope: string,
  code: string,
  message: string,
  error: unknown,
): { code: string; message: string; debug?: string } {
  const diagnostic = diagnosticFor(error);
  console.error(`[musea] ${scope} failed: ${code}\n${diagnostic}`);
  return DEBUG_ERRORS ? { code, message, debug: `${scope}: ${diagnostic}` } : { code, message };
}
