import { NextRequest, NextResponse } from "next/server";
import { jsonOrText, withApiErrors } from "@/app/api/_errors";

const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export const DELETE = withApiErrors(async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; techId: string }> }
) {
  const token = request.cookies.get("cluexp_access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  const { id, techId } = await context.params;
  const response = await fetch(
    `${apiBase}/api/provider/teams/${encodeURIComponent(id)}/technicians/${encodeURIComponent(techId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store"
    }
  );
  return NextResponse.json(await jsonOrText(response), { status: response.status });
});
