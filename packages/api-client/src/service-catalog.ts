export type ServiceCatalogStatus = "draft" | "active" | "deprecated";

export interface ServiceSkill {
  code: string;
  label: string;
  status: ServiceCatalogStatus;
  requires_verification: boolean;
  sort_order: number;
}

export interface ServiceCategory {
  code: string;
  label: string;
  status: ServiceCatalogStatus;
  sort_order: number;
  skills: ServiceSkill[];
}

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
  {
    code: "hvac",
    label: "HVAC",
    status: "draft",
    sort_order: 20,
    skills: []
  },
  {
    code: "towing",
    label: "Towing & Roadside",
    status: "draft",
    sort_order: 30,
    skills: []
  }
] as const satisfies ServiceCategory[];

export const LEGACY_SKILL_ALIASES: Record<string, string> = {
  vehicle: "locksmith.vehicle_lockout",
  car: "locksmith.vehicle_lockout",
  auto: "locksmith.vehicle_lockout",
  home: "locksmith.residential_lockout",
  residential: "locksmith.residential_lockout",
  business: "locksmith.commercial_lockout",
  commercial: "locksmith.commercial_lockout",
  broken_key: "locksmith.broken_key",
  rekey: "locksmith.rekey",
  smart_lock: "locksmith.smart_lock",
  key_programming: "locksmith.vehicle_key_programming"
};

export function flattenServiceSkills(catalog: ServiceCategory[] = DEFAULT_SERVICE_CATALOG): ServiceSkill[] {
  return catalog.flatMap((category) => category.skills);
}

export function serviceSkillLabel(skillCode: string, catalog: ServiceCategory[] = DEFAULT_SERVICE_CATALOG): string {
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
