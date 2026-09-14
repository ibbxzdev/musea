"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@musea/backend/convex/_generated/api";
import { userMessageFor } from "@musea/shared/errors";
import { authClient, leaveAuthenticatedApp } from "@/lib/auth-client";
import { FreighterError, useFreighter } from "@/lib/musea/freighter";
import { signInWithFreighter } from "@/lib/musea/wallet-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Whether the email and password form is offered.
 *
 * **Off for now, at the project owner's direction — wallet sign-in only.** Nothing was
 * deleted to do this: the form, its handler and its state all still compile and are still
 * type-checked, and `emailAndPassword` stays enabled in
 * `packages/backend/convex/auth.ts`. Existing email accounts still work, and this comes
 * back by flipping one boolean. That is the point of a flag rather than commented-out JSX,
 * which rots quietly and takes its `submit` handler and four pieces of state with it.
 *
 * **Know what this costs: there is now no way to sign in on a phone.** Freighter is a
 * desktop extension with no iOS build, so hiding email leaves iPhone Safari — the device
 * CLAUDE.md names as the verification target — with no path in at all. It also makes
 * Freighter the primary path, which SOW §4.2a says it must not become. Both are temporary
 * and both are resolved by the passkey work in Story 2.1, which is the sign-in that is
 * meant to work on a phone.
 *
 * Annotated `: boolean` deliberately. Without it TypeScript infers the literal type
 * `false`, and every branch below reads as statically dead.
 */
const EMAIL_SIGN_IN_ENABLED: boolean = false;

/**
 * The way in. Currently a Stellar wallet, with email and password behind the flag above.
 *
 * Deliberately plain. This exists to satisfy Story 0.3's done-criteria — sign up, sign in,
 * `users.viewer` returns the row, sign out returns null — and to make the two-account demo
 * recording possible. Epic 3 owns the real product UI; do not grow this into it.
 *
 * The viewer query is doing real work rather than decoration: it is the only thing that
 * proves the whole chain is connected. Better Auth can report a signed-in session while
 * Convex still sees an anonymous caller — a missing http.ts route, a JWKS mismatch, or an
 * `authSubject` that does not equal `identity.subject`.
 *
 * So it gates the redirect rather than being displayed. A good session goes straight to
 * `/app`; a session whose profile row is missing stops here and says why, because that is
 * the one case where continuing would show an app that looks broken for a reason two
 * screens behind the user.
 */
export default function SignInPage() {
  const router = useRouter();
  const viewer = useQuery(api.users.viewer, {});
  const { data: session, isPending } = authClient.useSession();

  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const freighter = useFreighter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({
              email,
              password,
              name: name || email.split("@")[0] || email,
            })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message ?? "That did not work. Check the email and password.");
        return;
      }
      router.refresh();
    } catch {
      setError("That did not work. Check the email and password.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sign in by proving the wallet is yours.
   *
   * Separate from `submit` rather than another branch inside it: this path has no form
   * fields, cannot fail validation, and its errors come back as FreighterErrors carrying a
   * shared TipErrorCode. Folding it in would mean a form handler that ignores the form.
   */
  async function continueWithWallet() {
    setError(null);
    setWalletBusy(true);
    try {
      await signInWithFreighter();
      // The session cookie is set. The redirect effect above takes it from here, once the
      // viewer query confirms Convex agrees a user exists.
      router.refresh();
    } catch (err) {
      if (err instanceof FreighterError && err.code === "SIGNATURE_REJECTED") {
        // Declining the popup is a decision, not a failure. Saying nothing matches what
        // the tip sheet does when a tip is cancelled.
        return;
      }
      setError(
        err instanceof FreighterError ? userMessageFor(err.code) : "That did not work. Try again.",
      );
    } finally {
      setWalletBusy(false);
    }
  }
  /**
   * Into the app once the session is genuinely usable.
   *
   * Gated on `viewer` resolving to a row, not merely on `session` existing. Better Auth can
   * report a signed-in session while Convex still sees an anonymous caller — a missing
   * http.ts route, a JWKS mismatch, or an `authSubject` that does not equal
   * `identity.subject`. Redirecting on `session` alone would push the user into an app
   * where every query returns empty, and the actual fault would be two screens behind them.
   *
   * `replace`, not `push`: Back from the app should not land on the sign-in screen of a
   * session you already have.
   */
  useEffect(() => {
    if (session && viewer) router.replace("/app");
  }, [session, viewer, router]);

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
              // `router.refresh()` re-renders the server components but keeps the Convex
              // client and the session atom alive, so this screen could re-render still
              // believing there is a session. A document load is what actually clears it.
              leaveAuthenticatedApp();
            }}
          >
            Sign out
          </Button>
        </main>
      );
    }

    // Session is good and the redirect above is in flight. A line rather than a spinner:
    // it resolves in a tick, and a spinner that flashes reads worse than a word.
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">
          {EMAIL_SIGN_IN_ENABLED && mode === "sign-up" ? "Create an account" : "Sign in"}
        </h1>
        <p className="text-sm text-muted-foreground">Musea Curator Tips — Stellar testnet.</p>
      </div>

      {EMAIL_SIGN_IN_ENABLED && (
        <form onSubmit={submit} className="space-y-4">
          {mode === "sign-up" && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="tap-target w-full" disabled={busy || isPending}>
            {busy ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>
      )}

      {/*
        Errors live out here rather than inside the form, because both paths set them and
        only one of the two is currently rendered. Inside the form, a wallet failure would
        have nowhere to appear at all.
      */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/*
        Hidden entirely when there is no extension, rather than rendered disabled. Freighter
        is desktop-only, so on a phone a visible "Continue with Freighter" button would be a
        dead end with no explanation.
      */}
      {freighter.state !== "unavailable" ? (
        <div className="space-y-3">
          {/* A divider only divides something. With email hidden there is nothing above. */}
          {EMAIL_SIGN_IN_ENABLED && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="tap-target w-full"
            disabled={busy || walletBusy || freighter.state === "checking"}
            onClick={continueWithWallet}
          >
            {walletBusy ? "Check Freighter…" : "Continue with Freighter"}
          </Button>

          {/*
            Freighter has only one approval popup, and it says "transaction". Saying so
            first is the difference between a signature people give and one they abandon.
          */}
          <p className="text-xs text-muted-foreground">
            Freighter will ask you to approve a transaction. It has sequence number 0, so it can
            never be submitted — signing only proves the wallet is yours. Nothing moves.
          </p>
        </div>
      ) : (
        /*
          No extension, and with email hidden there is now no other way in. Saying so beats
          a screen with a heading and nothing under it — which is what this page would
          otherwise be on every phone.
        */
        !EMAIL_SIGN_IN_ENABLED && (
          <div className="space-y-2 rounded-lg border p-4">
            <p className="text-sm font-medium">Freighter is required to sign in</p>
            <p className="text-sm text-muted-foreground">
              Musea signs you in with a Stellar wallet. Freighter is a desktop browser extension and
              has no iOS build, so this needs a computer for now.
            </p>
            <a
              href="https://www.freighter.app"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block text-sm text-stellar underline underline-offset-4"
            >
              Get Freighter
            </a>
          </div>
        )
      )}

      {EMAIL_SIGN_IN_ENABLED && (
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
      )}
    </main>
  );
}
