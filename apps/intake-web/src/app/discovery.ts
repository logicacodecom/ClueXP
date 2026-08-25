export const SITE_URL = "https://intake.cluexp.com";

export const PUBLIC_SERVICE_SKILLS = [
  {
    slug: "residential-lockout",
    code: "locksmith.residential_lockout",
    name: "Residential lockout",
    category: "Locksmith",
    categorySlug: "locksmith",
    description: "Emergency home lockout intake for verified dispatch and customer-safe tracking."
  },
  {
    slug: "vehicle-lockout",
    code: "locksmith.vehicle_lockout",
    name: "Vehicle lockout",
    category: "Locksmith",
    categorySlug: "locksmith",
    description: "Vehicle lockout intake for urgent access help, dispatch coordination, and status tracking."
  },
  {
    slug: "rekey",
    code: "locksmith.rekey",
    name: "Rekey service",
    category: "Locksmith",
    categorySlug: "locksmith",
    description: "Lock rekey request intake for customers and approved partners."
  }
] as const;

export const PUBLIC_SERVICE_CATEGORIES = [
  {
    slug: "locksmith",
    name: "Locksmith services",
    serviceType: "Locksmith",
    description:
      "Urgent locksmith-style access services through ClueXP intake, coverage checks, request creation, and privacy-minimized tracking.",
    skills: PUBLIC_SERVICE_SKILLS.filter((skill) => skill.categorySlug === "locksmith")
  }
] as const;

export const PUBLISHED_HOSTED_PARTNERS: {
  slug: string;
  name: string;
  description: string;
  serviceCategories: string[];
}[] = [];

export const PUBLIC_API_PATHS = [
  "GET /v1/services",
  "POST /v1/coverage-checks",
  "POST /v1/service-requests",
  "POST /v1/service-requests/{id}/dispatch-authorizations",
  "GET /v1/service-requests/{id}",
  "GET /v1/service-requests/{id}/tracking",
  "POST /v1/service-requests/{id}/cancellations"
] as const;

export const WITHHELD_AGENT_TOOLS = [
  "payment authorization/capture/refund tools",
  "private-to-network overflow tools",
  "provider ranking override tools",
  "internal roster, admin, ops, technician, raw tracking-token, or database tools"
] as const;

export function serviceCategoryUrl(slug: string) {
  return `${SITE_URL}/services/${slug}`;
}

export function serviceSkillUrl(categorySlug: string, skillSlug: string) {
  return `${SITE_URL}/services/${categorySlug}/${skillSlug}`;
}
