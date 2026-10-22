// Liveness: the Next.js server answers. Never calls the API, so an API outage cannot make the orchestrator restart healthy web servers.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
