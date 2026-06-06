import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const sessionResponse = await fetch(`${apiBase}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok) return NextResponse.json(session, { status: sessionResponse.status });
  const technicianId = session.technician?.id;
  if (!technicianId) {
    return NextResponse.json({ detail: "Technician profile is not available" }, { status: 403 });
  }
  const response = await fetch(`${apiBase}/api/technicians/${encodeURIComponent(technicianId)}/offers`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
