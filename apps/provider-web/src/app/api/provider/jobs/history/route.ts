import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

// The company's finished jobs, each with the customer review and both reported
// payment amounts/methods (technician collection + customer payment).
export async function GET(request: NextRequest) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const response = await fetch(`${apiBase}/api/provider/jobs/history`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
