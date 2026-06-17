import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ detail: "File is required" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ detail: "Invalid file type. Use JPG, PNG, GIF, or WebP." }, { status: 400 });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ detail: "File too large. Max 5MB." }, { status: 400 });
    }

    // Forward to backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);

    const response = await fetch(`${apiBase}/api/technicians/me/photo`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: backendFormData
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(body, { status: response.status });
    }

    return NextResponse.json({
      success: true,
      photo_url: body.photo_url,
      photo_status: body.photo_status,
      message: body.message || "Photo uploaded successfully"
    });
  } catch (cause) {
    return NextResponse.json({ detail: "Failed to upload photo" }, { status: 500 });
  }
}
