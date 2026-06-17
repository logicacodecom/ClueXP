import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cluexp_access_token";
const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "https://intake.cluexp.com";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const response = await fetch(`${apiBase}/api/technicians/me/documents`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, { status: response.status });
  }

  return NextResponse.json({ documents: await response.json() });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentType = formData.get("document_type") as string | null;
    const documentNumber = formData.get("document_number") as string | null;
    const expirationDate = formData.get("expiration_date") as string | null;

    if (!file) {
      return NextResponse.json({ detail: "File is required" }, { status: 400 });
    }

    if (!documentType) {
      return NextResponse.json({ detail: "Document type is required" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ detail: "Invalid file type. Use JPG, PNG, WebP, or PDF." }, { status: 400 });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ detail: "File too large. Max 10MB." }, { status: 400 });
    }

    // Forward to backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    backendFormData.append("document_type", documentType);
    if (documentNumber) {
      backendFormData.append("document_number", documentNumber);
    }
    if (expirationDate) {
      backendFormData.append("expiration_date", expirationDate);
    }

    const response = await fetch(`${apiBase}/api/technicians/me/documents`, {
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
      message: body.message || "Document uploaded successfully",
      document: body
    });
  } catch (cause) {
    return NextResponse.json({ detail: "Failed to upload document" }, { status: 500 });
  }
}
