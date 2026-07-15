import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(request: NextRequest, context: { params: Promise<{ type: string; id: string; decision: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { type, id, decision } = await context.params;
  if (!["technicians", "organizations"].includes(type) || !["approve", "reject"].includes(decision)) {
    return NextResponse.json({ detail: "Invalid approval action" }, { status: 400 });
  }
  const response = await fetch(`${apiBase}/api/admin/${type}/${encodeURIComponent(id)}/${decision}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
