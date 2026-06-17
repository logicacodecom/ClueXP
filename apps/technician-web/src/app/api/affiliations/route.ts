import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const techResponse = await fetch(`${apiBase}/api/technicians/me/affiliations`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const orgResponse = await fetch(`${apiBase}/api/technicians/me/organizations`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  const [techBody, orgBody] = await Promise.all([
    techResponse.json().catch(() => ({})),
    orgResponse.json().catch(() => ({}))
  ]);

  if (techResponse.status === 404 || techResponse.status === 501) {
    return NextResponse.json({
      affiliations: [],
      organizations: [],
      backend_ready: false,
      detail: "Technician affiliation endpoint is not available yet."
    });
  }

  if (!techResponse.ok) {
    return NextResponse.json(techBody, { status: techResponse.status });
  }

  return NextResponse.json({
    affiliations: techBody.affiliations || [],
    organizations: orgResponse.ok ? (orgBody.organizations || []) : [],
    backend_ready: true
  });
}
