// Public, read-only identity for the local Windows launcher. No Auth or database access.
export function GET() {
  return Response.json({ application: "jewelry-workshop-demo", protocol: 1 }, { headers: { "Cache-Control": "no-store" } });
}
