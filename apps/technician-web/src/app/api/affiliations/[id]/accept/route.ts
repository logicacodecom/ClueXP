import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ detail: "Affiliation ID required" }, { status: 400 });

  const response = await fetch(`${apiBase}/api/technicians/me/affiliations/${id}/accept`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    cache: "no-store"
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }

  return NextResponse.json({
    success: true,
    affiliation: body.affiliation,
    message: body.message || "Affiliation accepted"
  });
}
