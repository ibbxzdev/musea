"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@musea/backend/convex/_generated/api";
import { authClient, leaveAuthenticatedApp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The way in: email and password.
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
          {mode === "sign-up" ? "Create an account" : "Sign in"}
        </h1>
        <p className="text-sm text-muted-foreground">Musea Curator Tips — Stellar testnet.</p>
      </div>

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
