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
 * There is no wallet provider here. A wallet is a passkey smart account whose only signer
 * lives in the device's Secure Enclave, so there is nothing to provision on sign-in and no
 * key material for the app to hold — `getMyWallet` is a reactive query, which means the
 * profile card, the tip sheet and the gallery button cannot disagree about whether a
 * wallet exists. `WalletCard` on the profile is the only place one is created.
 */
export default function MuseaLayout({ children }: { children: React.ReactNode }) {
  return <MuseaShell>{children}</MuseaShell>;
}
