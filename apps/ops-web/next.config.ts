import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cluexp/console-ui", "@cluexp/api-client"]
};

export default nextConfig;
