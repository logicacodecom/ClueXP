import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(request: NextRequest) {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json(body, { status: response.status });
  const result = NextResponse.json({ session: body.session });
  result.cookies.set(COOKIE, body.access_token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86_400, path: "/"
  });
  return result;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const result = NextResponse.json(body, { status: response.status });
    if (response.status === 401) result.cookies.delete(COOKIE);
    return result;
  }
  return NextResponse.json({ session: body });
}

export async function DELETE() {
  const response = NextResponse.json({ signed_out: true });
  response.cookies.delete(COOKIE);
  return response;
}
