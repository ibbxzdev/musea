"use node";

/**
 * Stellar environment configuration, validated once at first use.
 *
 * §8 of the spec says "fail fast at startup if env vars missing" — a network/passphrase
 * mismatch otherwise shows up as an opaque signature error much later, after money has
 * notionally moved. Reading config through here means a misconfigured deployment fails
 * with a sentence a human can act on.
 */

export type StellarConfig = {
  network: "testnet" | "public";
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  /**
   * The native XLM Stellar Asset Contract.
   *
   * Tips move XLM, the network's own asset: it has no issuer and needs no trustline, so
   * there is nothing else about it to configure. This address is *derived* from the
   * network passphrase rather than chosen — see scripts/setup-testnet.sh — which is why
   * a testnet value will never work against pubnet.
   */
  xlmSacId: string;
  tipjarContractId: string;
  treasuryPublic: string;
  treasurySecret: string;
  /** Test XLM granted to each newly provisioned wallet, as a display string. */
  seedAmount: string;

  // ── Passkey smart accounts (Epic 2B) ───────────────────────────────────────────────
  /**
   * The OpenZeppelin smart-account WASM hash, and the verifier that checks secp256r1
   * WebAuthn assertions on-chain. Both are deployments of the Smart Account Kit's own
   * contracts, published per network — they are not ours and we do not deploy them.
   *
   * These two are what a smart account's *identity* is derived from, so changing either
   * one orphans every account already created. Treat them as append-only.
   */
  accountWasmHash: string;
  webauthnVerifierAddress: string;
  /**
   * The WebAuthn Relying Party ID — the domain a passkey is bound to.
   *
   * **A credential created under one RP ID does not resolve under another**, so dev
   * (`localhost`) and production (`musea-tips.vercel.app`) hold permanently separate
   * credentials, and therefore separate smart accounts. That is inherent to WebAuthn.
   * It is configuration rather than a constant precisely so the two can differ.
   */
  rpId: string;
  /**
   * Origins accepted when verifying a WebAuthn assertion. Must include the scheme, which
   * is why it cannot be derived from `rpId` — `localhost` is served over http and the
   * deployed domain over https.
   */
  allowedOrigins: string[];
  /** OpenZeppelin Channels, for gasless submission. The key is server-side only. */
  relayerUrl: string;
  relayerApiKey: string;
};

let cached: StellarConfig | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing Convex environment variable ${name}. ` +
        `Set it in the Convex dashboard (Settings -> Environment Variables). ` +
        `See .env.example for the full list and scripts/README.md for how to produce the values.`,
    );
  }
  return value.trim();
}

export function stellarConfig(): StellarConfig {
  if (cached) return cached;

  const network = required("STELLAR_NETWORK");
  if (network !== "testnet" && network !== "public") {
    throw new Error(`STELLAR_NETWORK must be "testnet" or "public", got "${network}".`);
  }

  const config: StellarConfig = {
    network,
    horizonUrl: required("HORIZON_URL"),
    rpcUrl: required("RPC_URL"),
    networkPassphrase: required("NETWORK_PASSPHRASE"),
    friendbotUrl: required("FRIENDBOT_URL"),
    xlmSacId: required("XLM_SAC_ID"),
    tipjarContractId: required("TIPJAR_CONTRACT_ID"),
    treasuryPublic: required("TREASURY_PUBLIC"),
    treasurySecret: required("TREASURY_SECRET"),
    seedAmount: process.env.SEED_AMOUNT?.trim() || "100",

    accountWasmHash: required("SMART_ACCOUNT_WASM_HASH"),
    webauthnVerifierAddress: required("WEBAUTHN_VERIFIER_ADDRESS"),
    rpId: required("WEBAUTHN_RP_ID"),
    // Defaulted from the RP ID rather than required, because getting the scheme wrong is
    // the common mistake and the right answer is mechanical: localhost is http, everything
    // else is https. Override only for an origin that is neither.
    allowedOrigins: (
      process.env.WEBAUTHN_ALLOWED_ORIGINS?.trim() ||
      defaultOriginFor(required("WEBAUTHN_RP_ID"))
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    relayerUrl: process.env.RELAYER_URL?.trim() || "https://channels.openzeppelin.com/testnet",
    relayerApiKey: required("RELAYER_API_KEY"),
  };

  // Catch the specific mix-up that costs the most time: pointing at testnet Horizon
  // while signing with the public network passphrase (or vice versa).
  const passphraseLooksTestnet = config.networkPassphrase.includes("Test SDF Network");
  if ((config.network === "testnet") !== passphraseLooksTestnet) {
    throw new Error(
      `STELLAR_NETWORK is "${config.network}" but NETWORK_PASSPHRASE is ` +
        `"${config.networkPassphrase}". These must agree, or every transaction will be ` +
        `rejected with an invalid signature.`,
    );
  }

  assertShape("TREASURY_PUBLIC", config.treasuryPublic, "G");
  assertShape("TREASURY_SECRET", config.treasurySecret, "S");
  assertShape("XLM_SAC_ID", config.xlmSacId, "C");
  assertShape("TIPJAR_CONTRACT_ID", config.tipjarContractId, "C");
  assertShape("WEBAUTHN_VERIFIER_ADDRESS", config.webauthnVerifierAddress, "C");

  // A WASM hash is 32 bytes of lowercase hex. Checked because the failure mode otherwise
  // is a deployment that simulates fine and produces an account nobody can connect to:
  // `connectWallet` rejects code whose hash is not in the accepted list, and the account
  // is immutable by then.
  if (!/^[0-9a-f]{64}$/.test(config.accountWasmHash)) {
    throw new Error(
      `SMART_ACCOUNT_WASM_HASH should be 64 lowercase hex characters, got "${config.accountWasmHash.slice(0, 12)}…".`,
    );
  }

  cached = config;
  return config;
}

/** http for localhost, https for everything else — the scheme WebAuthn will demand. */
function defaultOriginFor(rpId: string): string {
  return rpId === "localhost" || rpId.startsWith("localhost:")
    ? `http://${rpId}`
    : `https://${rpId}`;
}

function assertShape(name: string, value: string, prefix: "G" | "S" | "C"): void {
  if (!value.startsWith(prefix)) {
    const kind =
      prefix === "G" ? "account public key" : prefix === "S" ? "secret key" : "contract id";
    throw new Error(
      `${name} should be a Stellar ${kind} starting with "${prefix}", got "${value.slice(0, 6)}…".`,
    );
  }
}

/** Reset for tests. Not used in production paths. */
export function __resetConfigCache(): void {
  cached = null;
}
