import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";
const cookie = "cluexp_access_token";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  // Forward the raw multipart body (boundary intact) so the upstream UploadFile parses it.
  const body = await request.arrayBuffer();
  const response = await fetch(`${apiBase}/api/provider/organization/logo`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": request.headers.get("content-type") ?? "application/octet-stream"
    },
    body,
    cache: "no-store"
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
