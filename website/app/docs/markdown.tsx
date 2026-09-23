"use client";

import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { Mermaid } from "./mermaid";

// Renders docs markdown with GFM (tables, etc.) and github-slugger-style
// heading ids (rehype-slug), so in-page and cross-page `#anchor` links in the
// content actually resolve. Internal /docs links use the Next Link for
// client-side nav; external links open in a new tab. Styling is handled by
// the `.docs-content` rules in globals.css.
//
// A ```mermaid fence is intercepted at the `code` node and handed to <Mermaid>,
// which loads mermaid lazily and swaps in an SVG. Without this it renders as an
// ordinary code block showing the raw diagram source.

/**
 * If a <pre> wraps a single ```mermaid fence, return the diagram source.
 * Returns null for every other code block, which then renders normally.
 *
 * react-markdown hands `pre` its rendered <code> child, so the language lives
 * on that child's className and the source in its children.
 */
function mermaidSource(children: ReactNode): string | null {
  const only = Children.toArray(children)[0];
  if (!isValidElement(only)) return null;
  const props = only.props as { className?: string; children?: ReactNode };
  if (!/\blanguage-mermaid\b/.test(props.className ?? "")) return null;
  return String(props.children ?? "").replace(/\n$/, "");
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={{
        // Intercept at `pre`, not `code`: a diagram must not end up inside the
        // dark code panel `.docs-prose pre` paints, and a <div> inside a <pre>
        // is invalid HTML.
        pre({ children, ...props }) {
          const chart = mermaidSource(children);
          if (chart !== null) return <Mermaid chart={chart} />;
          return <pre {...props}>{children}</pre>;
        },
        a({ href, children, ...props }) {
          const url = href ?? "#";
          if (url.startsWith("/")) {
            return (
              <Link href={url} {...props}>
                {children}
              </Link>
            );
          }
          const external = url.startsWith("http");
          return (
            <a
              href={url}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              {...props}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
