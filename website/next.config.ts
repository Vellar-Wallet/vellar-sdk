import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  // Docs site — deployed standalone to docs.vellar.xyz.
  async rewrites() {
    return [
      // Serve the self-contained pitch deck at a clean, unlisted route.
      // The underlying file stays a standalone HTML document (no docs chrome).
      { source: "/pitchdeck", destination: "/pitchdeck.html" },
      // Raw markdown for agents: /docs/<slug>.md → the app/md route handler.
      // afterFiles rewrites are matched before the dynamic /docs/[slug] page,
      // so the .md suffix wins over the HTML route.
      { source: "/docs/:path*.md", destination: "/md/:path*" },
    ];
  },
};

// Wraps the config with fumadocs-mdx's Next.js plugin: compiles content/docs
// (via lib/fuma-source.ts's defineDocs + source.config.ts's global MDX
// options) into importable page data. Every docs route stays statically
// generated (generateStaticParams in app/docs/[...slug]/page.tsx) — this
// plugin only changes how .md files are compiled, not Next's rendering mode.
const withMDX = createMDX();

export default withMDX(nextConfig);
