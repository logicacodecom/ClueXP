import { AppFrame, ComplianceRow, Pill, Screen, Section, icons } from "@/components/mobile";

export default function DocumentsPage() {
  return (
    <AppFrame title="Documents">
      <Screen>
        <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Eligible</Pill>} subtitle="Blocking documents would prevent availability and auto accept." title="Compliance">
          <div className="space-y-2">
            <ComplianceRow label="Locksmith license" status="verified" date="Expires 2027-03-20" />
            <ComplianceRow label="Work authorization" status="verified" date="Expires 2027-08-11" />
            <ComplianceRow label="Insurance certificate" status="expiring" date="Expires 2026-07-15" />
            <ComplianceRow label="Background check" status="verified" date="Verified 2026-01-03" />
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
