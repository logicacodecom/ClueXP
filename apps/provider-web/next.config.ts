import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cluexp/console-ui", "@cluexp/api-client"],
  async redirects() {
    return [
      // Bookmark compatibility for the /reports -> /financial move. "by-tech"
      // must come before the dynamic :id redirect below, or Next matches the
      // literal segment "by-tech" as a technician id.
      { source: "/reports/technicians/by-tech", destination: "/financial/technicians", permanent: false },
      { source: "/reports/technicians/:id", destination: "/financial/technicians/:id", permanent: false },
      { source: "/reports/technicians", destination: "/financial/technicians", permanent: false },
      { source: "/reports/jobs", destination: "/financial/jobs", permanent: false },
      { source: "/reports/payments", destination: "/financial/payments", permanent: false },
      { source: "/reports", destination: "/financial/settlements", permanent: false }
    ];
  }
};

export default nextConfig;
