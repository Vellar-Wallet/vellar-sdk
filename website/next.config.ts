import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docs site — deployed standalone to sdk.vellar.xyz.
  async rewrites() {
    return [
      // Serve the self-contained pitch deck at a clean, unlisted route.
      // The underlying file stays a standalone HTML document (no docs chrome).
      { source: "/pitchdeck", destination: "/pitchdeck.html" },
    ];
  },
};

export default nextConfig;
