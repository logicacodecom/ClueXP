import type { MetadataRoute } from "next";
import { SITE_URL } from "./discovery";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: `${SITE_URL}/ai`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8
    },
    {
      url: `${SITE_URL}/llms.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7
    },
    {
      url: `${SITE_URL}/openapi-v1.json`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6
    }
  ];
}
