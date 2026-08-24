/** @type {import('next').NextConfig} */
const localApiBase = process.env.LOCAL_API_BASE_URL || "http://127.0.0.1:8000";

const nextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV === "production") {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${localApiBase}/:path*`
      },
      {
        source: "/v1/:path*",
        destination: `${localApiBase}/v1/:path*`
      }
    ];
  }
};

export default nextConfig;
