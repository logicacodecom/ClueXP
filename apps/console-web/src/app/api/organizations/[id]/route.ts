import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/api/admin/organizations/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
