import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const format = request.nextUrl.searchParams.get("format");
  const response = await fetch(`${apiBase}/api/provider/settlement-periods/${encodeURIComponent(id)}${format ? `?format=${encodeURIComponent(format)}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (format === "csv") {
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=cluexp-settlement-${id}.csv`,
      },
    });
  }
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
