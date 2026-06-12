import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const sessionRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!sessionRes.ok) {
    const body = await sessionRes.json().catch(() => ({}));
    return NextResponse.json(body, { status: sessionRes.status });
  }
  const session = await sessionRes.json();
  const technicianId = session.technician?.id;
  if (!technicianId) return NextResponse.json({ detail: "Technician profile not available" }, { status: 403 });

  const jobRes = await fetch(`${apiBase}/api/technicians/${encodeURIComponent(technicianId)}/active-job`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const job = await jobRes.json().catch(() => ({}));
  if (!jobRes.ok) return NextResponse.json(job, { status: jobRes.status });
  if (!job.id || job.id !== id) {
    return NextResponse.json({ detail: "Job not found or not your active job" }, { status: 404 });
  }
  return NextResponse.json(job);
}
