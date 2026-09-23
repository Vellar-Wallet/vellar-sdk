"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_TABS, getDocTab } from "@/lib/docs-registry";

// The tab row above the sidebar. Each tab links to the first page of its first
// section, and swaps the whole sidebar (see DocsNav).
//
// The active tab comes from the pathname rather than route params: this row
// renders from app/docs/layout.tsx, which sits above the [...slug] segment, so
// Next.js hands it no params. DocsNav resolves its tab the same way, which
// keeps the two in step without threading a prop through a server component.

export function DocsTabs() {
  const pathname = usePathname();
  const activeTab = getDocTab(pathname.replace(/^\/docs\/?/, ""));

  return (
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
  );
}
