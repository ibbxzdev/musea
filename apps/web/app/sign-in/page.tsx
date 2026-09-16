"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { userMessageFor } from "@musea/shared/errors";
import { useQuery } from "convex/react";
import { Fingerprint, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, leaveAuthenticatedApp } from "@/lib/auth-client";
import {
  createPasskey,
  PasskeyError,
  passkeysSupported,
  signInWithPasskey,
} from "@/lib/musea/passkey";

/**
 * The way in: Face ID, and nothing else.
 *
 * Email and password are gone (`convex/auth.ts`). The same passkey that authorizes tips is
 * the one that signs you in — one Face ID enrolment, two jobs — so creating an account here
 * also creates the Stellar smart account, with no second prompt and no seed phrase
 * anywhere in the flow.
 *
 * ## The rule this whole page is shaped around
 *
 * **Safari consumes user activation across an `await`.** Fetch a challenge inside the tap
 * handler and *then* call `navigator.credentials`, and the Face ID sheet silently never
 * appears — no error, nothing to catch, on the exact device the demo is recorded on. So
 * both challenges are prefetched before the user can tap, and every handler calls into
 * WebAuthn synchronously with the challenge already in hand. A challenge is single-use, so
 * each is refreshed after every attempt.
 *
 * The viewer query is doing real work rather than decoration: it is the only thing that
 * proves the whole chain is connected. Better Auth can report a signed-in session while
 * Convex still sees an anonymous caller — a missing http.ts route, a JWKS mismatch, or an
 * `authSubject` that does not equal `identity.subject`. So it gates the redirect rather
 * than being displayed.
 */
export default function SignInPage() {
  const router = useRouter();
  const viewer = useQuery(api.users.viewer, {});
  const { data: session } = authClient.useSession();

  const supported = React.useMemo(() => passkeysSupported(), []);

  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Prefetched so a tap never has to await one. Null means "not ready yet". */
  const [signInChallenge, setSignInChallenge] = React.useState<string | null>(null);
  const [signUpOptions, setSignUpOptions] = React.useState<{
    options: unknown;
    challenge: string;
  } | null>(null);

  const prefetchSignIn = React.useCallback(() => {
    if (!supported) return;
    setSignInChallenge(null);
    authClient.passkey
      .signInOptions()
      .then((result) => setSignInChallenge(result.data?.challenge ?? null))
      .catch(() => setSignInChallenge(null));
  }, [supported]);

  React.useEffect(() => {
    prefetchSignIn();
  }, [prefetchSignIn]);

  /**
   * Sign-up options depend on the name, which the user is still typing — so unlike the
   * sign-in challenge this cannot simply be fetched on mount. Debounced, because the name
   * is baked into the credential and shows in the OS passkey list: fetching per keystroke
   * would both hammer the endpoint and risk enrolling "Ib" instead of "Ibrahim".
   */
  const trimmedName = name.trim();
  React.useEffect(() => {
    if (!supported || mode !== "sign-up" || !trimmedName) {
      setSignUpOptions(null);
      return;
    }
    let cancelled = false;
    setSignUpOptions(null);
    const timer = setTimeout(() => {
      authClient.passkey
        .signUpOptions({ displayName: trimmedName })
        .then((result) => {
          const options = result.data?.options;
          if (cancelled || !options) return;
          // The challenge is kept alongside the options because verify needs it as the
          // lookup key for the server-side row that holds the name the user typed.
          setSignUpOptions({ options, challenge: options.challenge });
        })
        .catch(() => {
          if (!cancelled) setSignUpOptions(null);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supported, mode, trimmedName]);

  /**
   * Into the app once the session is genuinely usable.
   *
   * Gated on `viewer` resolving to a row, not merely on `session` existing — see the note
   * above. `replace`, not `push`: Back from the app should not land on the sign-in screen
   * of a session you already have.
   */
  React.useEffect(() => {
    if (session && viewer) router.replace("/app");
  }, [session, viewer, router]);

  async function handleSignIn() {
    if (busy) return;
    if (!signInChallenge) {
      setError("Still getting ready — try again in a second.");
      prefetchSignIn();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Synchronous inside the tap: the challenge is already here.
      const response = await signInWithPasskey(signInChallenge);
      const result = await authClient.passkey.signInVerify({
        response,
        challenge: signInChallenge,
      });
      if (result.error) {
        setError(result.error.message ?? "That passkey could not be verified.");
        return;
      }
      router.refresh();
    } catch (error) {
      setError(describe(error, "Could not sign you in."));
    } finally {
      setBusy(false);
      // Single-use, whatever happened.
      prefetchSignIn();
    }
  }

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !trimmedName) return;
    if (!signUpOptions) {
      setError("Still getting ready — try again in a second.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await createPasskey(signUpOptions.options);
      const result = await authClient.passkey.signUpVerify({
        response,
        challenge: signUpOptions.challenge,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not create that account.");
        return;
      }
      router.refresh();
    } catch (error) {
      setError(describe(error, "Could not create your account."));
    } finally {
      setBusy(false);
      setSignUpOptions(null);
    }
  }

  // ── Signed in ────────────────────────────────────────────────────────────────────────

  if (session) {
    // The profile row is missing — the failure the diagnostic below exists to catch. This
    // is the one signed-in state that must not redirect: the app would look broken and
    // this screen is where the reason is legible.
    if (viewer === null) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">Signed in, but no profile</h1>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Better Auth subject</dt>
                <dd className="font-mono break-all">{session.user.id}</dd>
              </div>
            </dl>
            <p className="text-sm text-destructive">
              Convex resolved no profile row. Either the onCreate trigger did not run, or
              users.authSubject does not match identity.subject.
            </p>
          </div>
          <Button
            className="tap-target"
            variant="outline"
            onClick={async () => {
              await authClient.signOut();
              leaveAuthenticatedApp();
            }}
          >
            Sign out
          </Button>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </main>
    );
  }

  // ── No passkeys here at all ──────────────────────────────────────────────────────────

  if (!supported) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6 py-12">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Passkeys aren&apos;t available here</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Musea signs you in with Face ID or Touch ID — there is no password. Open Musea in Safari
          or Chrome; some in-app browsers (Instagram, TikTok) don&apos;t support it.
        </p>
      </main>
    );
  }

  // ── The way in ───────────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === "sign-up" ? "Create your account" : "Sign in to Musea"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "sign-up"
            ? "One tap creates your account and your Stellar wallet together. No password, no seed phrase."
            : "Musea Curator Tips — Stellar testnet."}
        </p>
      </div>

      {mode === "sign-in" ? (
        <div className="space-y-3">
          <Button
            onClick={() => void handleSignIn()}
            disabled={busy}
            className="tap-target h-12 w-full rounded-full text-base"
          >
            <Fingerprint className="size-5" />
            {busy ? "Checking…" : "Sign in with Face ID"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Your passkey lives on this device. Musea never sees it, and there is no password to lose
            — or to steal.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              autoComplete="name"
              autoFocus
              placeholder="Ada Lovelace"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              This is what other curators see, and how the passkey is labelled on your device.
            </p>
          </div>
          <Button
            type="submit"
            disabled={busy || !trimmedName}
            className="tap-target h-12 w-full rounded-full text-base"
          >
            <Fingerprint className="size-5" />
            {busy ? "Creating…" : "Create account with Face ID"}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        variant="ghost"
        className="tap-target"
        onClick={() => {
          setMode(mode === "sign-up" ? "sign-in" : "sign-up");
          setError(null);
        }}
      >
        {mode === "sign-up" ? "I already have an account" : "Create an account instead"}
      </Button>
    </main>
  );
}

/**
 * A sentence for a human.
 *
 * A dismissed Face ID sheet is a decision, not a failure — `SIGNATURE_REJECTED` returns
 * null so the page simply stays put rather than accusing the user of an error they chose.
 */
function describe(error: unknown, fallback: string): string | null {
  if (error instanceof PasskeyError) {
    if (error.code === "SIGNATURE_REJECTED") return null;
    return userMessageFor(error.code);
  }
  return fallback;
}
