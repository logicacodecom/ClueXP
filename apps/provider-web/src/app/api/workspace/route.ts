import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
const cookie = "cluexp_access_token";

export async function GET(request: NextRequest) {
  return proxy(request, "/api/provider/workspace");
}

export async function PATCH(request: NextRequest) {
  return proxy(request, "/api/provider/organization", "PATCH", await request.json());
}

async function proxy(request: NextRequest, path: string, method = "GET", body?: unknown) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
