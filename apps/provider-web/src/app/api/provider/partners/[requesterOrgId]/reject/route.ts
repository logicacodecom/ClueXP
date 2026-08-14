import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requesterOrgId: string }> }
) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { requesterOrgId } = await params;
  const response = await fetch(`${apiBase}/api/provider/partners/${requesterOrgId}/reject`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});
