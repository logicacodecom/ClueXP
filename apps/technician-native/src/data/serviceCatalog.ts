// Mirrors packages/api-client/src/service-catalog.ts. technician-native can't
// resolve that workspace package (no metro.config.js sets up monorepo/watchFolders
// resolution for this app), so this is a small, deliberately-duplicated subset —
// keep in sync if the shared catalog changes shape.
export type ServiceCatalogStatus = "draft" | "active" | "deprecated";

export type ServiceSkill = {
  code: string;
  label: string;
  status: ServiceCatalogStatus;
  requires_verification: boolean;
  sort_order: number;
};

export type ServiceCategory = {
  code: string;
  label: string;
  status: ServiceCatalogStatus;
  sort_order: number;
  skills: ServiceSkill[];
};

export const DEFAULT_SERVICE_CATALOG: ServiceCategory[] = [
  {
    code: "locksmith",
    label: "Locksmith",
    status: "active",
    sort_order: 10,
    skills: [
      { code: "locksmith.vehicle_lockout", label: "Vehicle lockout", status: "active", requires_verification: false, sort_order: 10 },
      { code: "locksmith.residential_lockout", label: "Residential lockout", status: "active", requires_verification: false, sort_order: 20 },
      { code: "locksmith.commercial_lockout", label: "Commercial lockout", status: "active", requires_verification: false, sort_order: 30 },
      { code: "locksmith.broken_key", label: "Broken key extraction", status: "active", requires_verification: true, sort_order: 40 },
      { code: "locksmith.rekey", label: "Rekey", status: "active", requires_verification: false, sort_order: 50 },
      { code: "locksmith.smart_lock", label: "Smart lock", status: "active", requires_verification: true, sort_order: 60 },
      { code: "locksmith.vehicle_key_programming", label: "Vehicle key programming", status: "active", requires_verification: true, sort_order: 70 }
    ]
  },
  { code: "hvac", label: "HVAC", status: "draft", sort_order: 20, skills: [] },
  { code: "towing", label: "Towing & Roadside", status: "draft", sort_order: 30, skills: [] }
];

export function flattenServiceSkills(catalog: ServiceCategory[]): ServiceSkill[] {
  return catalog.flatMap((category) => category.skills);
}

export function serviceSkillLabel(skillCode: string, catalog: ServiceCategory[]): string {
  const found = flattenServiceSkills(catalog).find((skill) => skill.code === skillCode);
  if (found) return found.label;
  return skillCode
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
