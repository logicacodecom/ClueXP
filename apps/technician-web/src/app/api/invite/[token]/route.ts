import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export const GET = withApiErrors(async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await fetch(`${apiBase}/api/technician-invites/${encodeURIComponent(token)}`, {
    cache: "no-store"
  });
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});
