"use node";

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for custodial Stellar secret keys.
 *
 * Threat model for THIS scope (testnet, no real value): a database leak must not hand
 * over usable secret keys. The master key lives only in Convex environment variables, so
 * the ciphertext in the `stellarWallets` table is inert without it.
 *
 * What this deliberately does NOT do: key rotation, per-user derived keys, or an HSM/KMS.
 * Those belong to the follow-on SCF phase alongside the move to non-custodial signing.
 * See the custody section of docs/Musea_Instawards_SOW.md — the SOW is explicit about
 * this being production-shaped hygiene rather than production custody.
 *
 * Hard rules:
 *  - This file is Node-runtime only ("use node") because it needs node:crypto.
 *  - A decrypted secret exists only as a local in an action, and is never returned,
 *    stored, or logged.
 */

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

export type EncryptedBlob = {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
};

let cachedKey: Buffer | null = null;

/**
 * Read and validate the master key. Fails loudly at first use rather than silently
 * encrypting with a truncated or missing key.
 */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MASTER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and " +
        "set it in the Convex dashboard (Settings -> Environment Variables). It must never " +
        "be committed or sent to the client.",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "It should be the base64 of 32 random bytes.",
    );
  }

  cachedKey = key;
  return key;
}

/** Encrypt a Stellar secret key (S...) for storage. */
export function encryptSecret(secret: string): string {
  if (!secret.startsWith("S")) {
    // Cheap guard against accidentally encrypting (and thus storing) the wrong value.
    throw new Error("Refusing to encrypt a value that is not a Stellar secret key.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob: EncryptedBlob = {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
  return JSON.stringify(blob);
}

/**
 * Decrypt a stored secret. The GCM auth tag makes tampering a decrypt failure rather
 * than a wrong-but-plausible key.
 */
export function decryptSecret(stored: string): string {
  let blob: EncryptedBlob;
  try {
    blob = JSON.parse(stored) as EncryptedBlob;
  } catch {
    throw new Error("Stored wallet secret is not valid JSON — refusing to decrypt.");
  }

  if (blob.v !== 1) {
    throw new Error(`Unsupported encrypted blob version: ${String(blob.v)}`);
  }

  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Stored wallet secret has a malformed IV or auth tag.");
  }

  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");

  if (!plain.startsWith("S")) {
    throw new Error("Decrypted value is not a Stellar secret key.");
  }
  return plain;
}

/**
 * Self-check used by the setup script: proves the configured master key round-trips
 * before anyone provisions a wallet with it.
 */
export function verifyEncryptionConfigured(): boolean {
  const probe = "SPROBE" + randomBytes(24).toString("hex").toUpperCase();
  const out = decryptSecret(encryptSecret(probe));
  return timingSafeEqual(Buffer.from(out), Buffer.from(probe));
}
