export const SITE_URL = "https://intake.cluexp.com";

export const PUBLIC_SERVICE_SKILLS = [
  {
    code: "locksmith.residential_lockout",
    name: "Residential lockout",
    category: "Locksmith",
    description: "Emergency home lockout intake for verified dispatch and customer-safe tracking."
  },
  {
    code: "locksmith.vehicle_lockout",
    name: "Vehicle lockout",
    category: "Locksmith",
    description: "Vehicle lockout intake for urgent access help, dispatch coordination, and status tracking."
  },
  {
    code: "locksmith.rekey",
    name: "Rekey service",
    category: "Locksmith",
    description: "Lock rekey request intake for customers and approved partners."
  }
] as const;

export const PUBLIC_API_PATHS = [
  "GET /v1/services",
  "POST /v1/coverage-checks",
  "POST /v1/service-requests",
  "GET /v1/service-requests/{id}",
  "GET /v1/service-requests/{id}/tracking"
] as const;

export const WITHHELD_AGENT_TOOLS = [
  "POST /v1/service-requests/{id}/dispatch-authorizations",
  "POST /v1/service-requests/{id}/cancellations"
] as const;
