import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
const offersPath = process.env.CLUEXP_TECHNICIAN_OFFERS_PATH || "/api/offers";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}${offersPath}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
