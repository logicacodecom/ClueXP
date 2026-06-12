import { headers } from "next/headers";
import type { TechnicianAppProfile } from "@cluexp/api-client";
import { ActionList, AppFrame, MiniStat, ProfileStrip, Screen, Section, icons } from "@/components/mobile";
import { SignOutButton } from "@/components/client-widgets";

async function getSession(): Promise<Record<string, unknown> | null> {
  try {
    const headerList = await headers();
    const host = headerList.get("host");
    const protocol = headerList.get("x-forwarded-proto") ?? "http";
    if (!host) return null;
    const response = await fetch(`${protocol}://${host}/api/session`, {
      cache: "no-store",
      headers: { cookie: headerList.get("cookie") ?? "" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return (data.session as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const session = await getSession();
  const tech = session?.technician as Record<string, unknown> | null | undefined;
  const user = session?.user as Record<string, unknown> | null | undefined;
  const roles = (session?.roles as string[]) ?? [];

  const realProfile: TechnicianAppProfile = {
    technician_id: String(tech?.id ?? ""),
    availability: tech?.is_available ? "online" : "offline",
    gps_state: "tracking_active",
    alarm_state: "sound_enabled",
    auto_accept: false,
    current_shift_started_at: new Date().toISOString(),
    workspace_label: String(session?.organization_name ?? "Verified Network"),
    masked_phone: "",
  };

  return (
    <AppFrame title="Profile">
      <Screen>
        <ProfileStrip profile={realProfile} />
        <Section title="Trust profile">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Role" value={roles[0] ?? "technician"} tone="info" />
            <MiniStat label="Status" value={String(tech?.status ?? "active")} tone="success" />
            <MiniStat label="Vetting" value={String(tech?.vetting_status ?? "verified")} tone="success" />
            <MiniStat label="Display" value={String(user?.display_name ?? "--")} tone="info" />
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
        <SignOutButton />
      </Screen>
    </AppFrame>
  );
}
