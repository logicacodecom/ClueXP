import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(request: NextRequest) {
  const response = await fetch(`${apiBase}/api/auth/register/organization`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()), cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json(body, { status: response.status });
  // Sign the new provider-admin in immediately so onboarding has a session.
  const result = NextResponse.json({ session: body.session });
  if (body.access_token) {
    result.cookies.set(COOKIE, body.access_token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86_400, path: "/"
    });
  }
  return result;
}
