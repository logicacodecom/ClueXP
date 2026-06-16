import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

// Org-wide audit log: recent lifecycle/recovery events across the company's jobs.
// Tenant-scoped server-side; forwards the dispatcher's session to FastAPI.
export async function GET(request: NextRequest) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}/api/provider/audit`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
