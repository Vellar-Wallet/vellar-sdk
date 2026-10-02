import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "./mermaid";

// MDX components map fed to each compiled page's default export (see
// app/docs/[...slug]/page.tsx). `Mermaid` resolves the <Mermaid chart="..."/>
// node source.config.ts's remarkMdxMermaid plugin produces from a
// ```mermaid fence — see that file's comment for the full pipeline.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Mermaid,
    ...components,
  };
}
