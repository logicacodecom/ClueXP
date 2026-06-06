import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(request: NextRequest) {
  const response = await fetch(`${apiBase}/api/auth/register/organization`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()), cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
