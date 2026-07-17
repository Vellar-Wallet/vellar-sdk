"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOC_SECTIONS } from "@/lib/docs-registry";

// Client-side docs nav: section-grouped links with active-link highlighting +
// a mobile open/close toggle (the sidebar is off-canvas below the breakpoint).

export function DocsNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
          {DOC_SECTIONS.map((group) => (
            <div key={group.section} className="docs-nav-group">
              <p className="docs-nav-label mono">{group.section}</p>
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
