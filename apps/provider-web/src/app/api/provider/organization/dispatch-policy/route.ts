import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
const cookie = "cluexp_access_token";

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const body = await request.json();
  const response = await fetch(`${apiBase}/api/provider/organization/dispatch-policy`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
