import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export const GET = withApiErrors(async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/api/provider/users/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/api/provider/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store"
  });
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id } = await context.params;
  const response = await fetch(`${apiBase}/api/provider/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store"
  });
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});
