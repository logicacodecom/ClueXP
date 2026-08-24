import type { MetadataRoute } from "next";
import {
  PUBLIC_SERVICE_CATEGORIES,
  PUBLIC_SERVICE_SKILLS,
  SITE_URL,
  serviceCategoryUrl,
  serviceSkillUrl
} from "./discovery";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
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
      url: `${SITE_URL}/services`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.85
    },
    {
      url: `${SITE_URL}/partners`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.65
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

  const serviceCategories: MetadataRoute.Sitemap = PUBLIC_SERVICE_CATEGORIES.map((category) => ({
    url: serviceCategoryUrl(category.slug),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8
  }));

  const serviceSkills: MetadataRoute.Sitemap = PUBLIC_SERVICE_SKILLS.map((skill) => ({
    url: serviceSkillUrl(skill.categorySlug, skill.slug),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.75
  }));

  return [...base, ...serviceCategories, ...serviceSkills];
}
