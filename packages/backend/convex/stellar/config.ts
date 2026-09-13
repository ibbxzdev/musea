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
  usdcAssetCode: string;
  usdcIssuer: string;
  usdcSacId: string;
  tipjarContractId: string;
  treasuryPublic: string;
  treasurySecret: string;
  /** Test USDC granted to each newly provisioned wallet, as a display string. */
  seedAmount: string;
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
    usdcAssetCode: required("USDC_ASSET_CODE"),
    usdcIssuer: required("USDC_ISSUER"),
    usdcSacId: required("USDC_SAC_ID"),
    tipjarContractId: required("TIPJAR_CONTRACT_ID"),
    treasuryPublic: required("TREASURY_PUBLIC"),
    treasurySecret: required("TREASURY_SECRET"),
    seedAmount: process.env.SEED_AMOUNT?.trim() || "100",
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

  assertShape("USDC_ISSUER", config.usdcIssuer, "G");
  assertShape("TREASURY_PUBLIC", config.treasuryPublic, "G");
  assertShape("TREASURY_SECRET", config.treasurySecret, "S");
  assertShape("USDC_SAC_ID", config.usdcSacId, "C");
  assertShape("TIPJAR_CONTRACT_ID", config.tipjarContractId, "C");

  cached = config;
  return config;
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
