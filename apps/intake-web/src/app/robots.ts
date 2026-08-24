import type { MetadataRoute } from "next";
import { SITE_URL } from "./discovery";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/ai", "/llms.txt", "/openapi-v1.json"],
      disallow: ["/api/", "/o/", "/t/"]
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
