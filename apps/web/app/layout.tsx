import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Musea Curator Tips",
  description: "Tip a curator in XLM on Stellar — one tap, no wallet to install.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * `viewport-fit=cover` lets the page draw under the notch and home indicator, which is
   * what makes `env(safe-area-inset-*)` return non-zero values. Without it the safe-area
   * padding in globals.css silently does nothing.
   */
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen-safe antialiased">
        <Providers>
          {children}
          {/* Bottom-center reads better than top-right on a phone — it sits near the
              thumb and clear of the notch. */}
          <Toaster position="bottom-center" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
