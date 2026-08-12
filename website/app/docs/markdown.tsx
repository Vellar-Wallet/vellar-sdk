"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";

// Renders docs markdown with GFM (tables, etc.) and github-slugger-style
// heading ids (rehype-slug), so in-page and cross-page `#anchor` links in the
// content actually resolve. Internal /docs links use the Next Link for
// client-side nav; external links open in a new tab. Styling is handled by
// the `.docs-content` rules in globals.css.

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={{
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
