import { headers } from "next/headers";
import { ActionList, AppFrame, MiniStat, Pill, Screen, Section, icons } from "@/components/mobile";
import { SignOutButton } from "@/components/client-widgets";
import { ProfileEditor } from "@/components/profile-editor";

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

  const displayName = String(user?.display_name ?? "Technician");
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <AppFrame title="Profile">
      <Screen>
        <div className="mb-4 border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Pill tone={tech?.is_available ? "success" : "muted"}>{tech?.is_available ? "online" : "offline"}</Pill>
              <h1 className="mt-4 font-condensed text-4xl font-bold uppercase leading-none">{displayName}</h1>
              <p className="mt-2 text-sm text-muted">{String(session?.organization_name ?? "Independent technician")}</p>
            </div>
            <div className="flex size-14 items-center justify-center bg-card-strong text-xl font-black">{initials}</div>
          </div>
        </div>
        <ProfileEditor
          initialName={displayName}
          initialPhone={String(tech?.phone ?? user?.phone ?? "")}
          initialRadius={typeof tech?.service_area_radius_km === "number" ? tech.service_area_radius_km : null}
          initialSkills={Array.isArray(tech?.skills) ? tech.skills.map(String) : []}
        />
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
              { href: "/settings", icon: icons.Headphones, label: "App settings", sub: "Language, availability and location" }
            ]}
          />
        </Section>
        <SignOutButton />
      </Screen>
    </AppFrame>
  );
}
