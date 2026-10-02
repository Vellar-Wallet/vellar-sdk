import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider";
import SearchDialog from "./search";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vellar SDK — Docs",
  description:
    "Documentation for vellar-sdk: the passkey smart-wallet SDK for Stellar. Add passkey login, a Soroban smart account, and fee-sponsored payments to your app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes (via fumadocs' RootProvider)
    // sets the `class`/`style` attribute on <html> before hydration to avoid
    // a flash of the wrong theme; React would otherwise warn about the
    // server/client markup mismatch on that one attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700,500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* defaultTheme "light" + enableSystem false: first-time visitors
            always see light mode regardless of OS preference (decision:
            default theme is light, not "system"). The toggle fumadocs'
            DocsLayout renders stays fully functional for switching to
            dark. */}
        <RootProvider
          theme={{ defaultTheme: "light", enableSystem: false }}
          search={{ SearchDialog }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
