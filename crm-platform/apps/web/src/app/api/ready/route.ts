// Readiness: this web server can reach the API it proxies to. The body is a fixed word, never the URL or the fetch error.
export const dynamic = 'force-dynamic';

export const READY_DEADLINE_MS = 2_000;

export async function GET() {
  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3000';
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(READY_DEADLINE_MS), cache: 'no-store' });
    if (res.ok) return Response.json({ status: 'ok', api: 'up' });
  } catch {
    /* fall through to 503 */
  }
  return Response.json({ status: 'degraded', api: 'down' }, { status: 503 });
}
