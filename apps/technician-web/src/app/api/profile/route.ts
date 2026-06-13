import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}/api/technicians/me/profile`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(await request.json()),
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
