// Liveness probe for the host. Deliberately touches nothing else, so a slow database does not restart the app.
export function GET() {
  return Response.json({ ok: true });
}
