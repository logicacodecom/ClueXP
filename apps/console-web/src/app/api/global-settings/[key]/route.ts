import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function PATCH(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { key } = await context.params;
  const response = await fetch(`${apiBase}/api/admin/global-settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
