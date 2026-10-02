import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// DocsLayout renders `nav.title` in two places (fumadocs-ui/layouts/docs):
// unconditionally in the sidebar's own header row, and again in its
// `md:hidden` mobile navbar. The brand's always-visible topbar (preserved
// exactly — decision: keep it, see app/docs/docs-shell.tsx's <Topbar>) is
// hand-rendered as a sibling of DocsLayout at every breakpoint, including
// mobile (nothing hides .docs-topbar below any width) — so a `nav.title`
// wordmark here is redundant everywhere, not just on desktop. Omitting it
// previously left a second, always-visible wordmark sitting in the sidebar
// header, directly above the search box.
export function baseLayoutOptions(): BaseLayoutProps {
  return {
    nav: {
      url: "/",
    },
  };
}
