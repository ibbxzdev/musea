"use client";

import * as React from "react";
import { STELLAR_NETWORK } from "./stellar";

/**
 * The Freighter browser extension, and the only module in this app that talks to it.
 *
 * Written against https://docs.freighter.app. Three properties of that API shape
 * everything below, and getting any of them wrong fails silently:
 *
 *   1. **Nothing throws.** Every call resolves to its result object with an optional
 *      `error: { code, message, ext? }` field. A `try`/`catch` around these catches
 *      nothing — every call site has to test `.error` explicitly.
 *   2. **`getAddress()` returns an empty string** when the site is not authorized, rather
 *      than erroring. Emptiness is the signal, not failure.
 *   3. **`signTransaction` returns `signerAddress` alongside `signedTxXdr`** — which account
 *      actually signed. It need not be the one we built for.
 *
 * **This does not break CLAUDE.md rule 1.** `@stellar/freighter-api` is a postMessage
 * bridge to an extension, not a Stellar SDK — it builds nothing and understands no ledger
 * format. Everything crossing it is an opaque XDR string that a Convex action built and
 * that the same action will submit. `@stellar/stellar-sdk` stays banned in `apps/web`.
 *
 * **Every import is dynamic.** Next pre-renders client components on the server, where
 * `window` does not exist. Importing at module scope risks evaluating extension-detection
 * during SSR; importing inside the call keeps it in the browser and out of the first load.
 *
 * Freighter is a **desktop extension**. There is no iOS Safari build — its mobile story is
 * WalletConnect to a separate app, which is not this. `state` is `unavailable` on a phone,
 * and the UI must offer the built-in wallet there rather than a dead button.
 */

/** What the extension calls the network we are configured for: PUBLIC | TESTNET. */
export const EXPECTED_NETWORK = STELLAR_NETWORK === "public" ? "PUBLIC" : "TESTNET";

/**
 * The canonical identifier for that network.
 *
 * These are public Stellar constants, not configuration — the exact strings, spaces and
 * semicolon included, that every signature commits to.
 */
export const EXPECTED_PASSPHRASE =
  STELLAR_NETWORK === "public"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

/**
 * Is the wallet on our network?
 *
 * **Judged by passphrase, not by name.** `getNetwork()` returns one of PUBLIC, TESTNET,
 * FUTURENET or STANDALONE — and STANDALONE is what a custom network entry reports, even
 * one pointed at testnet with the testnet passphrase. Matching the name would reject a
 * wallet that is, at the only level that matters to a signature, on exactly the right
 * network. The passphrase is what signing actually commits to, so it is the honest test.
 *
 * The name is used only as a fallback for the older API shape that omitted the passphrase.
 */
export function isExpectedNetwork(network: string | null, passphrase: string | null): boolean {
  if (passphrase) return passphrase === EXPECTED_PASSPHRASE;
  return network !== null && network.toUpperCase() === EXPECTED_NETWORK;
}

export type FreighterState =
  /** Still detecting. Render nothing wallet-shaped yet; it flickers otherwise. */
  | "checking"
  /** No extension in this browser — every phone, and most desktops. */
  | "unavailable"
  /** Installed, but this site is not authorized, or no wallet is unlocked. */
  | "available"
  /** Authorized, unlocked, and we know the address. */
  | "connected";

export type FreighterInfo = {
  state: FreighterState;
  address: string | null;
  /** As the extension reports it, e.g. "TESTNET". */
  network: string | null;
  /** The extension's own passphrase for that network. Never hardcode this. */
  networkPassphrase: string | null;
  /** True when connected but pointed at the wrong network — the commonest wrong turn. */
  wrongNetwork: boolean;
};

const DISCONNECTED: FreighterInfo = {
  state: "unavailable",
  address: null,
  network: null,
  networkPassphrase: null,
  wrongNetwork: false,
};

/** Carries a shared TipErrorCode so the UI renders the same messages as the backend does. */
export class FreighterError extends Error {
  constructor(
    readonly code:
      | "WALLET_NOT_INSTALLED"
      | "WALLET_NOT_CONNECTED"
      | "SIGNATURE_REJECTED"
      | "WALLET_NETWORK_MISMATCH"
      | "WALLET_ADDRESS_CHANGED",
    /** The extension's own message, for the console. Never rendered. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FreighterError";
  }
}

/**
 * How long to keep asking before concluding the extension is not there.
 *
 * `isConnected()` answers by talking to a content script the extension injects, and that
 * injection is not synchronous with our first render. A single check on mount races it and
 * loses often enough to matter — reporting "not installed" to someone who has it installed,
 * with no way back because nothing re-checks. Retrying costs a few hundred milliseconds in
 * the genuinely-absent case, which is invisible next to a wrong answer that sticks.
 */
const DETECT_ATTEMPTS = 6;
const DETECT_INTERVAL_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read current state without prompting for anything. */
async function readState({ retry = false }: { retry?: boolean } = {}): Promise<FreighterInfo> {
  if (typeof window === "undefined") return DISCONNECTED;

  try {
    const api = await import("@stellar/freighter-api");

    let installed = await api.isConnected();
    // Only the initial mount retries. A later re-read (focus, manual recheck) is answering
    // a question the user just asked, and should not sit spinning for two seconds.
    for (let attempt = 1; retry && attempt < DETECT_ATTEMPTS; attempt += 1) {
      if (!installed.error && installed.isConnected) break;
      await sleep(DETECT_INTERVAL_MS);
      installed = await api.isConnected();
    }
    if (installed.error || !installed.isConnected) return DISCONNECTED;

    // `isAllowed` is the documented way to ask "is this site authorized" without showing
    // the user anything. Checking it before `getAddress` keeps the two states — no
    // extension vs. extension present but not authorized — genuinely distinguishable.
    const allowed = await api.isAllowed();
    if (allowed.error || !allowed.isAllowed) {
      return { ...DISCONNECTED, state: "available" };
    }

    const addr = await api.getAddress();
    // Documented: an empty string means not authorized or locked, and is not an error.
    if (addr.error || !addr.address) {
      return { ...DISCONNECTED, state: "available" };
    }

    const net = await api.getNetwork();
    if (net.error) return { ...DISCONNECTED, state: "available" };

    return {
      state: "connected",
      address: addr.address,
      network: net.network,
      networkPassphrase: net.networkPassphrase,
      wrongNetwork: !isExpectedNetwork(net.network, net.networkPassphrase),
    };
  } catch {
    // The dynamic import itself can fail (blocked, offline). Indistinguishable from "not
    // installed" as far as the UI is concerned, and nothing here is actionable.
    return DISCONNECTED;
  }
}

/**
 * Prompt for access. Must be called from a user gesture, or the popup may be suppressed.
 *
 * `requestAccess` both asks and returns the granted address, so there is no separate
 * `setAllowed` step.
 */
export async function requestFreighterAccess(): Promise<FreighterInfo> {
  const api = await import("@stellar/freighter-api");

  const installed = await api.isConnected();
  if (installed.error || !installed.isConnected) {
    throw new FreighterError("WALLET_NOT_INSTALLED", installed.error?.message);
  }

  const granted = await api.requestAccess();
  if (granted.error || !granted.address) {
    // Declining the popup arrives here as an error field, not a throw. Either way the
    // user said no, which is a decision rather than a failure.
    throw new FreighterError("SIGNATURE_REJECTED", granted.error?.message);
  }

  const net = await api.getNetwork();
  if (net.error) {
    throw new FreighterError("WALLET_NETWORK_MISMATCH", net.error.message);
  }

  return {
    state: "connected",
    address: granted.address,
    network: net.network,
    networkPassphrase: net.networkPassphrase,
    wrongNetwork: !isExpectedNetwork(net.network, net.networkPassphrase),
  };
}

/**
 * Hand an unsigned envelope to the extension and get it back signed.
 *
 * The XDR is opaque in both directions: a Convex action built it, and the same action
 * verifies on the way back that what returns hashes to what it built.
 *
 * `expectedAddress` is checked twice over — the passphrase is read live rather than
 * assumed, and the returned `signerAddress` is compared against what we built for. Both
 * guard the same mid-flow hazard: the user switching account or network in the extension
 * between the tip sheet opening and the popup being approved.
 */
export async function signWithFreighter(xdr: string, expectedAddress: string): Promise<string> {
  const api = await import("@stellar/freighter-api");

  // Ask the extension for its passphrase instead of hardcoding one. Signing against a
  // passphrase the wallet is not actually on yields a signature valid for a network nobody
  // submitted to — it fails at submit with an opaque error that reads like a contract bug.
  const net = await api.getNetwork();
  if (net.error) throw new FreighterError("WALLET_NETWORK_MISMATCH", net.error.message);
  if (!isExpectedNetwork(net.network, net.networkPassphrase)) {
    throw new FreighterError("WALLET_NETWORK_MISMATCH", `wallet on ${net.network}`);
  }

  const result = await api.signTransaction(xdr, {
    networkPassphrase: net.networkPassphrase,
    address: expectedAddress,
  });

  if (result.error || !result.signedTxXdr) {
    throw new FreighterError("SIGNATURE_REJECTED", result.error?.message);
  }

  // Freighter reports which account actually signed. If the user switched accounts while
  // the popup was open, this is the only place it is visible — the transaction source
  // would no longer match the signature and the submit would fail unexplainably.
  if (result.signerAddress && result.signerAddress !== expectedAddress) {
    throw new FreighterError("WALLET_ADDRESS_CHANGED", "signerAddress differs from source");
  }

  return result.signedTxXdr;
}

/**
 * Reactive extension state.
 *
 * Everything interesting about Freighter happens outside this tab — the user unlocks it,
 * switches account, or changes network in the extension popup, and the page is told
 * nothing. `WatchWalletChanges` is the API's own answer: it fires the callback only when
 * the address, network or passphrase actually differs, so this is a subscription rather
 * than a re-render on every poll.
 */
export function useFreighter(): FreighterInfo & { refresh: () => Promise<void> } {
  const [info, setInfo] = React.useState<FreighterInfo>({
    ...DISCONNECTED,
    state: "checking",
  });

  const refresh = React.useCallback(async () => {
    setInfo(await readState());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let watcher: { stop: () => void } | null = null;

    /**
     * Re-read when the tab regains focus.
     *
     * This is the recovery path, and it is not optional: installing Freighter, unlocking
     * it, or switching network all happen in another window, and coming back is the moment
     * the answer changes. Without it, a page that decided "not installed" on first paint
     * stays wrong until a manual reload — which is exactly the dead end this replaced.
     * `WatchWalletChanges` only reports changes once a provider exists, so it cannot cover
     * the not-yet-installed case on its own.
     */
    const reread = async () => {
      const next = await readState();
      if (!cancelled) setInfo(next);
    };

    const start = async () => {
      const initial = await readState({ retry: true });
      if (cancelled) return;
      setInfo(initial);

      window.addEventListener("focus", reread);

      // Nothing to subscribe to without a provider. Focus re-reads above are what pick it
      // up if one appears later.
      if (initial.state === "unavailable") return;

      try {
        const api = await import("@stellar/freighter-api");
        const instance = new api.WatchWalletChanges(2000);
        if (cancelled) return;

        instance.watch(({ address, network, networkPassphrase }) => {
          setInfo({
            state: address ? "connected" : "available",
            address: address || null,
            network: network || null,
            networkPassphrase: networkPassphrase || null,
            wrongNetwork: Boolean(network) && !isExpectedNetwork(network, networkPassphrase),
          });
        });
        watcher = instance;
      } catch {
        // Watching is an enhancement; the initial read above already populated state.
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", reread);
      watcher?.stop();
    };
  }, []);

  return { ...info, refresh };
}
