import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { code } = await params;
  const body = await request.text();
  const response = await fetch(`${apiBase}/api/admin/service-catalog/categories/${encodeURIComponent(code)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
