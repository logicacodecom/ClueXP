import { NextRequest, NextResponse } from "next/server";

const publicPaths = ["/signin", "/signup", "/onboarding"];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.png" ||
    pathname === "/logo.png"
  ) {
    return NextResponse.next();
  }
  if (!request.cookies.has("cluexp_access_token")) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"]
};
