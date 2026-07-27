import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const response = await fetch(`${apiBase}/api/auth/register/technician`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()), cache: "no-store"
  });
  const body = await jsonOrText(response);
  return NextResponse.json(body, { status: response.status });
});
