import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docs site — deployed standalone to sdk.vellar.xyz.
  async rewrites() {
    return [
      // Serve the self-contained pitch deck at a clean, unlisted route.
      // The underlying file stays a standalone HTML document (no docs chrome).
      { source: "/pitchdeck", destination: "/pitchdeck.html" },
      // Raw markdown for agents: /docs/<slug>.md → the app/md route handler.
      // afterFiles rewrites are matched before the dynamic /docs/[slug] page,
      // so the .md suffix wins over the HTML route.
      { source: "/docs/:slug.md", destination: "/md/:slug" },
    ];
  },
};

export default nextConfig;
