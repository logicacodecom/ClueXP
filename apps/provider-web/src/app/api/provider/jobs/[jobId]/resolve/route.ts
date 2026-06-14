import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

// Dispute resolution forwards to the tenant-scoped /admin/jobs/{id}/resolve
// (a dispatcher may resolve only its own organization's jobs).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${apiBase}/api/admin/jobs/${jobId}/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
