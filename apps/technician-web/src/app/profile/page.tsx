import { headers } from "next/headers";
import { AppFrame, EmptyState, Screen, Section, icons } from "@/components/mobile";
import { AvailabilityToggle, SignOutButton } from "@/components/client-widgets";
import { ProfileEditor } from "@/components/profile-editor";
import { PhotoUploadWrapper } from "@/components/photo-upload-wrapper";
import Link from "next/link";

interface TechnicianAffiliation {
  id: string;
  organization_id: string;
  organization_name?: string;
  status: "pending_invite" | "active" | "suspended" | "ended" | "rejected";
  affiliation_type?: string;
  exclusivity?: string;
  dispatch_allowed?: boolean;
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
  const affiliations = (tech?.affiliations as TechnicianAffiliation[] | undefined) ?? [];

  const displayName = String(user?.display_name ?? "Technician");
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const photoUrl = typeof tech?.photo_url === "string" ? tech.photo_url : null;
  const photoStatus = tech?.photo_status as "pending" | "approved" | "rejected" | null | undefined;

  return (
    <AppFrame title="Profile">
      <Screen>
        <div className="mb-4 border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold">{displayName}</p>
                <span className="text-sm text-muted">Independent technician</span>
              </div>
              <p className="mt-2 text-sm text-muted">
                {String(session?.organization_name ?? "No provider affiliation")}
              </p>
            </div>
            <div className="flex size-14 items-center justify-center rounded-full bg-card-strong text-xl font-black">
              {initials}
            </div>
          </div>
        </div>

        <Section title="Dispatch status">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <icons.BellRing className="size-5 text-muted" />
              <div>
                <div className="text-sm font-bold">Availability</div>
                <div className="text-xs text-muted">Show/hide from dispatch</div>
              </div>
            </div>
            <AvailabilityToggle />
          </div>
          <p className="mt-3 text-xs text-muted">
            Go online to receive job offers. You can update GPS below.
          </p>
        </Section>

        <Section title="Photo">
          <div className="rounded-xl border border-border bg-card p-4">
            <PhotoUploadWrapper
              currentPhotoUrl={photoUrl || undefined}
              photoStatus={photoStatus || undefined}
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Upload a clear headshot. Photos are reviewed before appearing on jobs.
          </p>
        </Section>

        <ProfileEditor
          initialName={displayName}
          initialPhone={String(tech?.phone ?? user?.phone ?? "")}
          initialRadius={typeof tech?.service_area_radius_km === "number" ? tech.service_area_radius_km : null}
          initialSkills={Array.isArray(tech?.skills) ? tech.skills.map(String) : []}
        />

        <Section title="Trust profile">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-card p-3">
              <div className="text-[10px] font-bold uppercase text-muted">Role</div>
              <div className="font-bold">{roles[0] ?? "technician"}</div>
            </div>
            <div className="rounded-xl bg-card p-3">
              <div className="text-[10px] font-bold uppercase text-muted">Global status</div>
              <div className="font-bold">{String(tech?.status ?? "active")}</div>
            </div>
            <div className="rounded-xl bg-card p-3">
              <div className="text-[10px] font-bold uppercase text-muted">Vetting</div>
              <div className="font-bold">{String(tech?.vetting_status ?? "verified")}</div>
            </div>
            <div className="rounded-xl bg-card p-3">
              <div className="text-[10px] font-bold uppercase text-muted">Display name</div>
              <div className="font-bold">{String(user?.display_name ?? "--")}</div>
            </div>
          </div>
        </Section>

        <Section title="Provider affiliations">
          <div className="rounded-xl border border-border bg-card p-4">
            {affiliations.length === 0 ? (
              <EmptyState
                title="No affiliations"
                icon={icons.Users}
                text="You are not yet affiliated with any provider companies. When you accept an invitation, it will appear here."
              />
            ) : (
              <div className="space-y-2">
                {affiliations.map((affiliation) => (
                  <div key={affiliation.id} className="rounded-xl bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-bold">
                          {affiliation.organization_name ??
                            `Organization ${affiliation.organization_id.slice(0, 8)}...`}
                        </div>
                        {affiliation.affiliation_type && (
                          <div className="text-xs text-muted">
                            {affiliation.affiliation_type.toUpperCase().replace("_", " ")}
                            {affiliation.exclusivity === "exclusive" && " • Exclusive"}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          affiliation.status === "active"
                            ? "bg-green-100 text-green-800"
                            : affiliation.status === "pending_invite"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                        }`}>
                          {affiliation.status}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="mt-3 w-full rounded-xl border border-border bg-card py-2 text-sm font-bold opacity-60" disabled>
            Invite to another company (coming soon)
          </button>
        </Section>

        <Section title="Profile tools">
          <div className="space-y-2">
            <Link className="touch-target flex w-full items-center justify-between rounded-xl border border-border bg-card p-3" href="/settings">
              <div className="flex items-center gap-3">
                <icons.Headphones className="size-5 text-muted" />
                <span className="font-bold">App settings</span>
              </div>
              <span className="text-sm text-muted">Language, GPS update, device controls</span>
            </Link>
          </div>
        </Section>

        <SignOutButton />
      </Screen>
    </AppFrame>
  );
}
