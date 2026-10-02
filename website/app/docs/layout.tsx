import type { ReactNode } from "react";
import { getTabPageTrees } from "@/lib/fuma-page-tree";
import { baseLayoutOptions } from "@/lib/layout-shared";
import { DocsShell } from "./docs-shell";

// Docs shell: brand topbar (via DocsLayout's nav/links slots, see
// lib/layout-shared.ts) + tab row + tab-scoped sidebar + content column.
// DocsShell (client) picks the right pre-built tree for the current
// pathname and renders DocsLayout with it.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <DocsShell trees={getTabPageTrees()} baseOptions={baseLayoutOptions()}>
      {children}
    </DocsShell>
  );
}
