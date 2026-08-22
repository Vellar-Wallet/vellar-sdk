import Link from "next/link";
import type { ReactNode } from "react";
import { DocsNav } from "./docs-nav";

// Docs shell: brand topbar + section-grouped sidebar + content column. The
// sidebar nav (active state + mobile toggle) is a client component; everything
// else is a server component. Self-contained — no dependency on the wallet app.

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-root">
      <header className="docs-topbar">
        <Link href="/" className="docs-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="docs-wordmark" src="/logo-mark.png" alt="Vellar SDK" />
        </Link>
        <div className="docs-topbar-spacer" />
        <a
          href="https://explorer.vellar.xyz"
          className="docs-toplink"
          target="_blank"
          rel="noopener noreferrer"
        >
          Explorer
        </a>
        <a
          href="https://github.com/Vellar-Wallet/vellar-sdk"
          className="docs-toplink"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a href="https://vellar.xyz" className="docs-launch">
          Open Vellar Wallet
        </a>
      </header>

      <div className="docs-body">
        <DocsNav />
        <main className="docs-content">{children}</main>
      </div>
    </div>
  );
}
