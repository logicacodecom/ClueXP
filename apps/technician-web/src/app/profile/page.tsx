import { currentTechnician, technicianAppProfile } from "@cluexp/api-client";
import { ActionList, AppFrame, MiniStat, ProfileStrip, Screen, Section, icons } from "@/components/mobile";

export default function ProfilePage() {
  return (
    <AppFrame title="Profile">
      <Screen>
        <ProfileStrip profile={technicianAppProfile} />
        <Section title="Trust profile">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Rating" value={String(currentTechnician.rating ?? "--")} tone="success" />
            <MiniStat label="No-show" value={String(currentTechnician.no_show_history ?? 0)} />
            <MiniStat label="Docs" value={currentTechnician.document_status} tone="success" />
            <MiniStat label="Risk" value={currentTechnician.payment_risk ?? "low"} tone="info" />
          </div>
        </Section>
        <Section title="Profile tools">
          <ActionList
            items={[
              { href: "/documents", icon: icons.ShieldCheck, label: "Documents and compliance", sub: "License, insurance, authorization" },
              { href: "/team", icon: icons.Users, label: "Team and organization", sub: "Individual or affiliated status" },
              { href: "/settings", icon: icons.Headphones, label: "App settings", sub: "Alarm, GPS, auto accept" }
            ]}
          />
        </Section>
      </Screen>
    </AppFrame>
  );
}
