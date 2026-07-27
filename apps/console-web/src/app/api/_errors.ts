import { NextResponse } from "next/server";

type RouteHandler = (...args: any[]) => Promise<Response>;

export function withApiErrors<T extends RouteHandler>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("BFF route failed", error);
      return NextResponse.json({ detail: "Service temporarily unavailable" }, { status: 502 });
    }
  }) as T;
}

/** Read an upstream response body, falling back to its text when it is not JSON.
 *  A Vercel gateway 502/504 answers with an HTML page, not JSON — parsing that
 *  away to {} is what leaves the browser showing a blank error. */
export async function jsonOrText(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    return { detail: snippet || `Upstream error ${response.status}` };
  }
}
