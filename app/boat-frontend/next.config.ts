import type { NextConfig } from "next";

/**
 * GitHub project Pages serves at /<repo>/. Set BASE_PATH when building for Pages.
 * Local / Vercel: leave unset.
 */
const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  ...(basePath
    ? {
        basePath,
        assetPrefix: basePath,
      }
    : {}),
};

export default nextConfig;
