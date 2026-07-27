import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

// The signed-in technician's finished jobs, each with the customer review and
// both reported payment amounts/methods.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const response = await fetch(`${apiBase}/api/technician/jobs/history`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await jsonOrText(response);
  return NextResponse.json(body, { status: response.status });
});
