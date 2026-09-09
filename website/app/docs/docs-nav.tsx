"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { getDocTab, getTabSections } from "@/lib/docs-registry";

// Client-side docs nav: section-grouped links with active-link highlighting +
// a mobile open/close toggle (the sidebar is off-canvas below the breakpoint).
//
// The sidebar shows only the sections under the active tab, so each tab in the
// row above swaps the whole rail rather than scrolling one long combined list.
// The tab is resolved from the pathname, the same way DocsTabs does it, because
// app/docs/layout.tsx sits above the [...slug] segment and gets no params.

export function DocsNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = getTabSections(getDocTab(pathname.replace(/^\/docs\/?/, "")));

  return (
    <>
      <button
        className="docs-menu-btn"
        aria-label="Toggle documentation menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Menu"}
      </button>

      <aside className={`docs-sidebar${open ? " open" : ""}`}>
        <nav>
          {sections.map((group) => (
            <div key={group.section} className="docs-nav-group">
              {/* A group that is just one self-titled page needs no label */}
              {(group.pages.length > 1 || group.pages[0]?.nav !== group.section) && (
                <p className="docs-nav-label mono">{group.section}</p>
              )}
              {group.pages.map((p) => {
                const href = `/docs/${p.slug}`;
                const active = pathname === href;
                return (
                  <Link
                    key={p.slug}
                    href={href}
                    className={`docs-nav-link${active ? " active" : ""}`}
                    onClick={() => setOpen(false)}
                  >
                    {p.nav}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
