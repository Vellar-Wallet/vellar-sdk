"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { DOC_TABS, getDocTab, type DocTabId } from "@/lib/docs-registry";
import type { TabPageTree } from "@/lib/fuma-page-tree";

// Brand topbar: logo, Explorer, GitHub, "Open Vellar Wallet" CTA — preserved
// exactly (same markup/classes as pre-migration), rendered as a persistent
// full-width sibling above DocsLayout rather than through its `nav`/`links`
// slots. fumadocs' own nav is mobile-only by design in this generation (see
// lib/layout-shared.tsx's comment), so a slot-based topbar can't reproduce
// an always-visible full-width bar; this is the closest fumadocs
// "customization point" gets without fighting its header component, short
// of a fully separate layout wrapper.
function Topbar() {
  return (
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
        href="https://github.com/Vellar-Wallet/vellar-facilitator"
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
  );
}

// Resolves the active tab from the pathname and renders:
//   1. the brand topbar (see Topbar above).
//   2. the tab row — a full-width band between the topbar and the
//      sidebar+content region, same position/behaviour as the pre-migration
//      docs-tabs.tsx (switching the whole sidebar per tab, not just
//      scrolling one combined list).
//   3. DocsLayout with that tab's pre-built tree.
//
// Both the topbar and tab row render as siblings of DocsLayout rather than
// through one of its slots — see each one's comment for why. This must be a
// client component (not just the tab row) because DocsLayout needs the
// right `tree` at render time, and the active tab depends on the pathname —
// app/docs/layout.tsx sits above the [...slug] segment and receives no
// params, exactly like before this migration.
export function DocsShell({
  trees,
  baseOptions,
  children,
}: {
  trees: Record<DocTabId, TabPageTree>;
  baseOptions: BaseLayoutProps;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activeTab = getDocTab(pathname.replace(/^\/docs\/?/, ""));

  return (
    <>
      <Topbar />
      <nav className="docs-tabrow" aria-label="Documentation sections">
        {DOC_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/docs/${tab.firstSlug}`}
            className={`docs-tab${tab.id === activeTab ? " active" : ""}`}
            aria-current={tab.id === activeTab ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <DocsLayout {...baseOptions} tree={trees[activeTab]}>
        {children}
      </DocsLayout>
    </>
  );
}
