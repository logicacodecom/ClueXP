import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
const ACTIONS = new Set(["approve", "reject", "suspend", "reactivate"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id, action } = await context.params;
  if (!ACTIONS.has(action)) return NextResponse.json({ detail: "Invalid action" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${apiBase}/api/admin/organizations/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
