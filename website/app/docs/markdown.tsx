"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders docs markdown with GFM (tables, etc.). Internal /docs links use the
// Next Link for client-side nav; external links open in a new tab. Styling is
// handled by the `.docs-content` rules in globals.css.

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
