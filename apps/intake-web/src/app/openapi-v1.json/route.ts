import snapshot from "../../../../../docs/openapi-v1-snapshot.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json(snapshot, {
    headers: {
      "cache-control": "public, max-age=3600"
    }
  });
}
