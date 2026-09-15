"use node";

import { randomBytes } from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { ConvexError, v } from "convex/values";
import { MemoryStorage, SmartAccountKit, type StoredCredential } from "smart-account-kit";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { classifyStellarError, userMessageFor } from "@musea/shared";
import { stellarConfig } from "./config";
import { RelayerError, submitViaRelayer } from "./relayer";
import { TipError } from "./tipsNode";

/**
 * Passkey smart accounts — the Stellar half (Stories 2B.1 / 2B.2).
 *
 * The whole epic turns on one constraint: **a Convex action cannot call the browser.**
 * WebAuthn lives on the device, and signing needs a round trip out to it and back, so
 * every passkey operation is split into two actions with the browser in between.
 *
 * Smart Account Kit is written for a browser, where that round trip is just an `await`.
 * It is usable from the server because it takes its WebAuthn implementation as an
 * injected dependency and never verifies the challenge it generated — so each half of a
 * split can hand it a function that *already has the answer*:
 *
 *   registration   we generate the options -> browser creates the credential
 *                  -> `startRegistration` returns the response we were given
 *   signing        we compute the auth digest -> browser signs it
 *                  -> `startAuthentication` returns the assertion we were given
 *
 * The kit then does the parts that are genuinely hard and easy to get wrong: extracting
 * the P-256 key from the attestation, computing the Protocol 27 auth digest, and
 * normalising the DER assertion to the low-S raw 64 bytes `secp256r1_verify` wants.
 *
 * `internalAction`s, so a `userId` argument is safe here. The auth-guarded surface is
 * `./passkey.ts`.
 */

/**
 * The WebAuthn payloads that cross between browser and server.
 *
 * Declared here rather than imported: the kit re-exports these from
 * `@simplewebauthn/browser`, and pulling that package into the backend to borrow two
 * structural types would add a browser dependency for no runtime benefit. They are
 * `v.any()` at the Convex boundary regardless — the shapes are the authenticator's, not
 * ours, and the kit is what actually parses them.
 */
export type RegistrationResponseJSON = {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; attestationObject: string; publicKey?: string };
};

export type AuthenticationResponseJSON = {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
};

/** Shown in the OS passkey sheet. Users see this next to the domain. */
const APP_NAME = "Musea";

/**
 * How much test XLM a new account starts with, in whole XLM.
 *
 * Friendbot funds a temporary classic account and the kit forwards it through the SAC, so
 * this is bounded by what Friendbot gives out, not by the treasury.
 */
const FUND_RESERVE_NOTE = "Funded via Friendbot through the native SAC.";

// ─────────────────────────────────────────────────────────────── registration, step 1

/**
 * WebAuthn creation options for the browser.
 *
 * Deliberately built here rather than taken from the kit: the kit generates options only
 * as a side effect of `createPasskey`, which cannot be reached without also performing
 * the ceremony. Since it never checks the challenge it generated, options produced here
 * and a credential created from them are accepted in step 2 without complaint.
 *
 * `residentKey: "required"` and `userVerification: "required"` are what make this a
 * discoverable passkey gated by Face ID rather than a silent second factor;
 * `authenticatorAttachment: "platform"` keeps it on the device instead of offering a
 * security key. `alg: -7` is ES256 (secp256r1) — the only algorithm the on-chain verifier
 * knows, so offering anything else would produce a credential that cannot sign for a
 * Stellar smart account.
 */
export const buildRegistrationOptions = internalAction({
  args: { userId: v.id("users"), userName: v.string() },
  handler: async (_ctx, { userId, userName }) => {
    const cfg = stellarConfig();
    return {
      challenge: randomBytes(32).toString("base64url"),
      rp: { id: cfg.rpId, name: APP_NAME },
      user: {
        // The Convex user id, so the credential is tied to this profile rather than to a
        // display name that can change. Never an email: it shows in the OS passkey list.
        id: Buffer.from(userId).toString("base64url"),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" as const }],
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const,
        residentKey: "required" as const,
        userVerification: "required" as const,
      },
      timeout: 60_000,
      attestation: "none" as const,
    };
  },
});

// ─────────────────────────────────────────────────────────────── registration, step 2

/**
 * Turn a freshly created credential into a deployed, funded smart account.
 *
 * Idempotent and resumable, because it is four network round trips and the retry path is
 * the one that actually gets exercised. Each step checks whether it has already happened:
 * a row that exists is reused, a deployment that landed is not repeated, and funding is
 * skipped for an account that already holds a balance. Re-running after a failure at any
 * step resumes rather than starting over — and, critically, never mints a second account,
 * which would strand whatever was in the first.
 */
export const provisionSmartAccount = internalAction({
  args: {
    userId: v.id("users"),
    userName: v.string(),
    registrationResponse: v.any(),
  },
  handler: async (ctx, { userId, userName, registrationResponse }): Promise<string> => {
    const cfg = stellarConfig();

    const existing = await ctx.runQuery(internal.stellar.internal.getSmartAccountByUser, {
      userId,
    });
    if (existing?.status === "deployed") return existing.contractAddress;

    const response = registrationResponse as RegistrationResponseJSON;

    try {
      // ── 1. Derive the account from the credential ────────────────────────────────────
      // `createWallet` extracts the P-256 key from the attestation and derives the
      // contract address deterministically. `autoSubmit: false` because the shared
      // deployer is sign-only — it cannot source a transaction or pay a fee, so the
      // relayer supplies both and we submit the payload ourselves.
      const storage = new MemoryStorage();
      const kit = buildKit({
        storage,
        webAuthn: { startRegistration: async () => response },
      });

      const created = await kit.createWallet(APP_NAME, userName, {
        autoSubmit: false,
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
        },
      });

      if (!created.relayerPayload) {
        throw new TipError(
          "PASSKEY_PROVISIONING_FAILED",
          "Smart Account Kit returned no relayer payload for the shared deployer.",
        );
      }

      const publicKeyHex = Buffer.from(created.publicKey).toString("hex");

      // Record before submitting, so a deployment that lands while the response is lost
      // still has a row to reconcile against rather than becoming an orphan account.
      const accountId: Id<"smartAccounts"> = await ctx.runMutation(
        internal.stellar.internal.upsertSmartAccount,
        {
          userId,
          contractAddress: created.contractId,
          credentialId: created.credentialId,
          publicKeyHex,
          rpId: cfg.rpId,
          status: "pending",
        },
      );

      // ── 2. Deploy, gaslessly ─────────────────────────────────────────────────────────
      const deployHash = await submitViaRelayer(
        created.relayerPayload.func,
        created.relayerPayload.auth,
      );

      // ── 3. Record the birth ──────────────────────────────────────────────────────────
      // Not bookkeeping: `connectWallet` refuses an account whose immutable birth it
      // cannot verify, and without these three it falls back to the public indexer, which
      // does not serve the claim it wants. Persisting them keeps the indexer off the
      // critical path permanently. See Story 2B.0, finding 3.
      const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);
      const creationTx = await rpc.pollTransaction(deployHash, { attempts: 30 });
      if (creationTx.status !== StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new TipError(
          "PASSKEY_PROVISIONING_FAILED",
          `Smart account deployment ${deployHash} settled as ${creationTx.status}.`,
        );
      }

      await ctx.runMutation(internal.stellar.internal.markSmartAccountDeployed, {
        accountId,
        birthWasmHash: cfg.accountWasmHash,
        creationTransactionHash: deployHash,
        creationLedger: creationTx.ledger,
      });

      // ── 4. Fund it ───────────────────────────────────────────────────────────────────
      // Separate from deployment on purpose: an account that exists but holds nothing is
      // recoverable on the next attempt, whereas coupling the two would make a funding
      // hiccup look like a failed account and tempt a second deployment.
      await fundIfEmpty(ctx, accountId, created.contractId, created.credentialId, publicKeyHex);

      return created.contractId;
    } catch (error) {
      const code = error instanceof TipError ? error.code : classifyStellarError(error);
      console.error(`smart account provisioning failed for ${userId}: ${code}`);
      await ctx.runMutation(internal.stellar.internal.markSmartAccountFailed, {
        userId,
        deploymentError: detail(error),
      });
      throw new ConvexError({ code, message: userMessageFor(code) });
    }
  },
});

/** Top up an account holding nothing. Safe to call repeatedly; a funded account is left alone. */
async function fundIfEmpty(
  ctx: ActionCtx,
  accountId: Id<"smartAccounts">,
  contractAddress: string,
  credentialId: string,
  publicKeyHex: string,
): Promise<void> {
  const cfg = stellarConfig();

  const balance = await readSacBalance(contractAddress);
  if (balance > 0n) {
    await ctx.runMutation(internal.stellar.internal.markSmartAccountFunded, { accountId });
    return;
  }

  const storage = new MemoryStorage();
  const kit = buildKit({ storage });
  await connectStoredWallet(kit, storage, {
    contractAddress,
    credentialId,
    publicKeyHex,
    birthWasmHash: cfg.accountWasmHash,
    creationTransactionHash: undefined,
    creationLedger: undefined,
  });

  const funded = await kit.fundWallet(cfg.xlmSacId);
  if (funded.success) {
    await ctx.runMutation(internal.stellar.internal.markSmartAccountFunded, { accountId });
  } else {
    // Not fatal. The account exists and can be funded on the next attempt or by the
    // treasury; refusing to hand it back would strand a perfectly good account.
    console.error(`funding ${contractAddress} failed: ${funded.error?.message ?? "unknown"}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────── balance

/** A smart account's XLM balance in stroops, from the native SAC's own storage. */
export const readSmartAccountBalance = internalAction({
  args: { contractAddress: v.string() },
  handler: async (_ctx, { contractAddress }): Promise<string> => {
    return (await readSacBalance(contractAddress)).toString();
  },
});

/**
 * Read an address's native-XLM balance through the SAC.
 *
 * Works for both address kinds, which is the point: a `C…` smart account has no classic
 * account and no trustline — the SAC keeps its balance in contract storage — so Horizon
 * would 404 on it forever. This is the only balance read that is correct for both.
 */
export async function readSacBalance(address: string): Promise<bigint> {
  const cfg = stellarConfig();
  const rpc = new StellarSdk.rpc.Server(cfg.rpcUrl);

  const source = await rpc.getAccount(cfg.treasuryPublic);
  const tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      new StellarSdk.Contract(cfg.xlmSacId).call(
        "balance",
        StellarSdk.Address.fromString(address).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    // An address the SAC has never seen simulates cleanly and returns 0, so a simulation
    // error here is a real fault rather than "no balance".
    throw new Error(`Simulation failed reading balance of ${address}: ${sim.error}`);
  }
  if (!sim.result) return 0n;
  return StellarSdk.scValToNative(sim.result.retval) as bigint;
}

// ──────────────────────────────────────────────────────────────────────── kit plumbing

type WebAuthnShim = {
  startRegistration?: (args: {
    optionsJSON: { challenge: string };
  }) => Promise<RegistrationResponseJSON>;
  /**
   * Receives the options the kit built so the caller can inspect `challenge` — which is
   * the auth digest, and the one value that has to agree across the two halves of a tip.
   */
  startAuthentication?: (args: {
    optionsJSON: { challenge: string };
  }) => Promise<AuthenticationResponseJSON>;
};

/**
 * A kit instance wired to this deployment.
 *
 * The WebAuthn half is whatever the caller injects — each is a function that resolves to
 * a response the browser already produced. Anything the kit calls that was not injected
 * throws, loudly and on purpose: a silent fallback to a real `navigator.credentials` call
 * is impossible here, and pretending otherwise would hide a wiring mistake until it
 * surfaced as an unsigned transaction.
 */
export function buildKit(options: {
  storage: MemoryStorage;
  webAuthn?: WebAuthnShim;
}): SmartAccountKit {
  const cfg = stellarConfig();

  const kit = new SmartAccountKit({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    accountWasmHash: cfg.accountWasmHash,
    webauthnVerifierAddress: cfg.webauthnVerifierAddress,
    horizonUrl: cfg.horizonUrl,
    rpId: cfg.rpId,
    rpName: APP_NAME,
    allowedOrigins: cfg.allowedOrigins,
    storage: options.storage,
    // Configured so the kit builds a relayer client and routes submission through it
    // rather than through RPC — the shared deployer is sign-only and cannot pay a fee.
    // The client it builds is then replaced below.
    relayerUrl: cfg.relayerUrl,
    // Cast at this one seam. The kit types these against `@simplewebauthn/browser`'s
    // response shapes; ours are the structural subset we actually read. The payloads are
    // opaque to us either way — the authenticator produces them and the kit parses them —
    // so the cast asserts nothing we could check more strictly.
    webAuthn: {
      startRegistration: async (args: { optionsJSON: { challenge: string } }) => {
        const shim = options.webAuthn?.startRegistration;
        if (!shim) throw new Error("No WebAuthn registration response was injected.");
        return await shim(args);
      },
      startAuthentication: async (args: { optionsJSON: { challenge: string } }) => {
        const shim = options.webAuthn?.startAuthentication;
        if (!shim) throw new Error("No WebAuthn assertion was injected.");
        return await shim(args);
      },
    } as never,
  });

  // Teach the kit's relayer client to authenticate.
  //
  // It posts exactly the body OpenZeppelin Channels expects but sends no `Authorization`
  // header, because it is written for a browser talking to a proxy that holds the key.
  // Overriding `send` — an own property shadowing the prototype method — lets us keep the
  // kit's submission path while supplying the header ourselves.
  //
  // The alternative was standing up a Convex httpAction as that proxy, which would have
  // put an internet-facing endpoint in front of a key that pays for transactions. This
  // keeps the key where it already is and adds no new attack surface.
  if (kit.relayer) {
    kit.relayer.send = async (func: string, auth: string[]) => {
      try {
        return { success: true, hash: await submitViaRelayer(func, auth) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error instanceof RelayerError ? error.relayerCode : undefined,
        };
      }
    };
  }

  return kit;
}

/**
 * Connect the kit to a stored account without touching the indexer.
 *
 * `connectWallet` verifies provenance from a stored credential when one carries complete
 * birth metadata, and only reaches for the indexer when it does not. Seeding the kit's
 * storage from our own row is therefore both faster and the only route that works — see
 * Story 2B.0, finding 3.
 */
export async function connectStoredWallet(
  kit: SmartAccountKit,
  storage: MemoryStorage,
  account: {
    contractAddress: string;
    credentialId: string;
    publicKeyHex: string;
    birthWasmHash?: string;
    creationTransactionHash?: string;
    creationLedger?: number;
  },
): Promise<void> {
  const credential: StoredCredential = {
    credentialId: account.credentialId,
    publicKey: new Uint8Array(Buffer.from(account.publicKeyHex, "hex")),
    contractId: account.contractAddress,
    createdAt: Date.now(),
    isPrimary: true,
    deploymentStatus: "deployed",
    birthWasmHash: account.birthWasmHash,
    creationTransactionHash: account.creationTransactionHash,
    creationLedger: account.creationLedger,
  };

  await storage.save(credential);
  await kit.connectWallet({
    contractId: account.contractAddress,
    credentialId: account.credentialId,
  });
}

/** Load the caller's account and connect a kit to it, or explain why we cannot. */
export async function connectedKitFor(
  account: Doc<"smartAccounts"> | null,
  webAuthn?: WebAuthnShim,
): Promise<{ kit: SmartAccountKit; account: Doc<"smartAccounts"> }> {
  const cfg = stellarConfig();

  if (!account) {
    throw new TipError("PASSKEY_NOT_REGISTERED", "This user has no smart account yet.");
  }
  if (account.status !== "deployed") {
    throw new TipError(
      "PASSKEY_PROVISIONING_FAILED",
      `Smart account for ${account.userId} is ${account.status}.`,
    );
  }
  // A passkey only resolves under the domain that created it. Catching the mismatch here
  // turns "Face ID never appeared" into a sentence naming the actual cause.
  if (account.rpId !== cfg.rpId) {
    throw new TipError(
      "PASSKEY_RP_MISMATCH",
      `Account was registered for "${account.rpId}" but this deployment serves "${cfg.rpId}".`,
    );
  }

  const storage = new MemoryStorage();
  const kit = buildKit({ storage, webAuthn });
  await connectStoredWallet(kit, storage, {
    contractAddress: account.contractAddress,
    credentialId: account.credentialId,
    publicKeyHex: account.publicKeyHex,
    birthWasmHash: account.birthWasmHash,
    creationTransactionHash: account.creationTransactionHash,
    creationLedger: account.creationLedger,
  });

  return { kit, account };
}

/** Server-side error text. Capped: RPC failures carry very large XDR blobs. */
function detail(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 2000);
}

export { FUND_RESERVE_NOTE };
