"use node";

import * as StellarSdk from "@stellar/stellar-sdk";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { stellarConfig } from "./config";

/**
 * SEP-0010 Stellar Web Authentication — proving someone holds a wallet's key.
 *
 * This is the cryptographic half of "sign in with your wallet". The ceremony is fixed by
 * the standard and is worth stating plainly, because the safety of the whole thing rests
 * on one unusual detail:
 *
 *   1. The server builds a **challenge transaction** on the client's account, signs it
 *      with its own key, and hands over the XDR.
 *   2. The wallet signs that XDR and hands it back.
 *   3. The server checks the client's signature is present and valid.
 *
 * **The challenge transaction has sequence number 0, and that is the security property.**
 * Sequence 0 is never valid on the network, so the thing the user signs can never be
 * submitted — no matter who intercepts it. A wallet signature is normally an instruction
 * to move money; here it is only a proof of key ownership, and the sequence number is what
 * makes that difference real rather than promised. Never "fix" the sequence number.
 *
 * Both operations in the challenge are `manageData`, which write nothing anyone can spend.
 *
 * **Why this file exists at all**, rather than the verification happening inside the Better
 * Auth plugin: `@stellar/stellar-sdk` needs the Node runtime, and `convex/auth.ts` runs in
 * Convex's default runtime. CLAUDE.md rule 1 puts every Stellar operation in an action
 * under `convex/stellar/` regardless; this is that rule and a runtime constraint agreeing.
 */

/**
 * How long a challenge stays good.
 *
 * Long enough to unlock an extension and read a popup, short enough that a challenge
 * captured from a screen or a log is worthless by the time anyone acts on it. The Better
 * Auth verification row is given the same horizon, so neither side outlives the other.
 */
export const CHALLENGE_TIMEOUT_SECONDS = 300;

/**
 * The domain the challenge is scoped to.
 *
 * SEP-0010 embeds this in the first `manageData` key and checks it on the way back, which
 * is what stops a challenge issued by one service being replayed at another. It must be
 * byte-identical across build and verify, so both go through here rather than deriving it
 * twice.
 *
 * Read from `SITE_URL` when set, because that is the deployment's real identity. The
 * fallback is only for local development, where there is no deployed origin to name.
 */
function authDomain(): string {
  const site = process.env.SITE_URL?.trim();
  if (site) {
    try {
      return new URL(site).host;
    } catch {
      // A malformed SITE_URL should not take sign-in down; fall through to the default.
    }
  }
  return "localhost:3000";
}

/**
 * A challenge for this address to sign.
 *
 * The treasury keypair is the SEP-0010 "server account". Reusing it here costs nothing:
 * the only thing it signs is a sequence-0 transaction that can never reach the network, so
 * a leaked challenge reveals a public key and a timestamp and nothing else.
 */
export const buildChallenge = internalAction({
  args: { publicKey: v.string() },
  handler: async (_ctx, { publicKey }): Promise<string> => {
    const cfg = stellarConfig();
    const server = StellarSdk.Keypair.fromSecret(cfg.treasurySecret);
    const domain = authDomain();

    return StellarSdk.WebAuth.buildChallengeTx(
      server,
      publicKey,
      domain,
      CHALLENGE_TIMEOUT_SECONDS,
      cfg.networkPassphrase,
      domain,
    );
  },
});

/**
 * Does `signedXdr` carry a valid signature from `publicKey` over the challenge we issued?
 *
 * Returns a boolean rather than throwing, because every failure here means the same thing
 * to the caller — this is not a proof of ownership — and the distinctions between them are
 * only useful in a server log. `verifyChallengeTxSigners` throws `InvalidChallengeError`
 * for a wrong signer, a tampered envelope, an expired window, and a mismatched domain
 * alike; none of those should reach a user as anything but "that didn't work".
 *
 * The `challengeXdr` argument is the copy the server stored, not one the browser sent
 * back. That is what makes this a real check: the client cannot choose the challenge it
 * gets graded against, so a signature over some other transaction proves nothing.
 */
export const verifyChallenge = internalAction({
  args: {
    challengeXdr: v.string(),
    signedXdr: v.string(),
    publicKey: v.string(),
  },
  handler: async (_ctx, { challengeXdr, signedXdr, publicKey }): Promise<boolean> => {
    const cfg = stellarConfig();
    const server = StellarSdk.Keypair.fromSecret(cfg.treasurySecret);
    const domain = authDomain();

    // The envelope coming back must be the one that went out, with signatures added and
    // nothing else changed. Comparing the transaction hashes is the cheapest complete
    // check: the hash covers every field a signature commits to, so an equal hash means an
    // identical transaction, and an unequal one means we are about to grade a signature
    // over something we never issued.
    try {
      const issued = new StellarSdk.Transaction(challengeXdr, cfg.networkPassphrase);
      const returned = new StellarSdk.Transaction(signedXdr, cfg.networkPassphrase);
      // `hash()` returns a Uint8Array, which has no value equality of its own —
      // comparing two of them with === compares references and is always false.
      if (!Buffer.from(issued.hash()).equals(Buffer.from(returned.hash()))) return false;
    } catch {
      return false;
    }

    try {
      const signers = StellarSdk.WebAuth.verifyChallengeTxSigners(
        signedXdr,
        server.publicKey(),
        cfg.networkPassphrase,
        [publicKey],
        domain,
        domain,
      );
      return signers.includes(publicKey);
    } catch {
      return false;
    }
  },
});
