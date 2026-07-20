import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppFrame, Screen } from "@/components/mobile";
import { AvailabilityToggle, SignOutButton } from "@/components/client-widgets";
import { ProfileEditor } from "@/components/profile-editor";
import { PhotoUploadWrapper } from "@/components/photo-upload-wrapper";
import { BellRing, ChevronRight, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <p className="field-kicker">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

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
  const photoUrl = typeof tech?.photo_url === "string" ? tech.photo_url : null;
  const photoStatus = tech?.photo_status as "pending" | "approved" | "rejected" | null | undefined;

  const vetting = String(tech?.vetting_status ?? "verified");
  const verified = vetting === "verified";

  return (
    <AppFrame title="Account">
      <Screen>
        <header className="flex items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <h1 className="font-condensed text-3xl font-bold uppercase leading-none">{displayName}</h1>
            <p className="mt-2 text-sm text-muted">
              {String(session?.organization_name ?? "No provider affiliation")}
            </p>
            <p className="mt-1 font-mono text-xs text-muted">ID {String(tech?.id ?? "—").slice(0, 8).toUpperCase()}</p>
            {verified ? (
              <span className="mt-3 inline-flex items-center gap-1.5 border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                <ShieldCheck className="size-3.5" />Identity verified
              </span>
            ) : (
              <span className="mt-3 inline-flex items-center gap-1.5 border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary capitalize">
                {vetting.replaceAll("_", " ")}
              </span>
            )}
          </div>
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card-strong font-condensed text-xl font-bold">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={displayName} className="size-full object-cover" src={photoUrl} />
            ) : initials}
          </div>
        </header>

        <FieldSection title="Dispatch status">
          <div className="flex items-center justify-between border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <BellRing className="size-5 text-muted" />
              <div>
                <div className="text-sm font-semibold">Availability</div>
                <div className="text-xs text-muted">Show or hide yourself from dispatch</div>
              </div>
            </div>
            <AvailabilityToggle />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">Go online to receive job offers. Location updates live in Settings.</p>
        </FieldSection>

        <FieldSection title="Photo">
          <div className="border border-border bg-card p-4">
            <PhotoUploadWrapper
              currentPhotoUrl={photoUrl || undefined}
              photoStatus={photoStatus || undefined}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">Upload a clear headshot. Photos are reviewed before appearing on jobs.</p>
        </FieldSection>

        <ProfileEditor
          initialName={displayName}
          initialPhone={String(tech?.phone ?? user?.phone ?? "")}
          initialRadius={typeof tech?.service_area_radius_km === "number" ? tech.service_area_radius_km : null}
          initialSkills={Array.isArray(tech?.skills) ? tech.skills.map(String) : []}
        />

        <FieldSection title="Trust profile">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Role", roles[0] ?? "technician"],
              ["Global status", String(tech?.status ?? "active")],
              ["Vetting", vetting],
              ["Affiliation", String(session?.organization_name ?? "None")]
            ].map(([label, value]) => (
              <div className="border border-border bg-card p-3" key={label}>
                <div className="text-[10px] font-bold uppercase tracking-[.08em] text-muted">{label}</div>
                <div className="mt-1 truncate font-semibold capitalize">{value}</div>
              </div>
            ))}
          </div>
        </FieldSection>

        <FieldSection title="More">
          <Link className="touch-target flex w-full items-center justify-between border border-border bg-card p-3" href="/settings">
            <span className="flex items-center gap-3">
              <SlidersHorizontal className="size-5 text-muted" />
              <span className="font-semibold">Settings</span>
            </span>
            <span className="flex items-center gap-2 text-sm text-muted">Language, location, privacy <ChevronRight className="size-4" /></span>
          </Link>
        </FieldSection>

        <div className="mt-6"><SignOutButton /></div>
      </Screen>
    </AppFrame>
  );
}
