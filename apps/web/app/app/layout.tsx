import type { Metadata } from "next";
import { MuseaShell } from "@/components/musea/musea-shell";

export const metadata: Metadata = {
  title: { default: "Musea", template: "%s · Musea" },
  description: "Your artifacts, galleries and the community — a visual library for what you keep.",
};

/**
 * The Musea app shell.
 *
 * Everything under `/app` is a section of the same product and shares this chrome. `/` is
 * left alone deliberately — see the note at the top of `app/page.tsx`.
 *
 * There is no wallet provider here any more. Wallets are the user's own (Freighter), so
 * there is nothing to provision on sign-in and no balance for the app to own — the tip
 * sheet reads the connected wallet where it needs it, and `ConnectWallet` on the profile is
 * the only place one is established.
 */
export default function MuseaLayout({ children }: { children: React.ReactNode }) {
  return <MuseaShell>{children}</MuseaShell>;
}
