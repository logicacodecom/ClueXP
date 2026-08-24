import { NextRequest, NextResponse } from "next/server";

function apiOnlyHostnames(): Set<string> {
  const raw = process.env.API_ONLY_HOSTNAMES || "api.cluexp.com";
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function requestHostname(request: NextRequest): string {
  const host = request.headers.get("host") || "";
  return host.split(":")[0]?.toLowerCase() || "";
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

export function proxy(request: NextRequest) {
  const host = requestHostname(request);
  const pathname = request.nextUrl.pathname;

  if (apiOnlyHostnames().has(host) && !isPublicApiPath(pathname)) {
    const requestId = crypto.randomUUID();
    return NextResponse.json(
      { error: "not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-ID": requestId } }
    );
  }

  return NextResponse.next();
}
