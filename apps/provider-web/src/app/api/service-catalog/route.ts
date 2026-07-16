import { NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET() {
  const response = await fetch(`${apiBase}/api/service-catalog`, { cache: "no-store" });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
