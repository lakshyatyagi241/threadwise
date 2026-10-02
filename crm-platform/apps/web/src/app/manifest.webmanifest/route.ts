import { apiBase } from '@/lib/auth/server';

/** The app-wide web manifest (TW-SET-036): built by the API from the PWA settings; 404 while installable-app support is off. */
export async function GET() {
  try {
    const res = await fetch(`${apiBase()}/v2/public/manifest.webmanifest`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      return new Response(await res.text(), {
        headers: {
          'content-type': 'application/manifest+json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
  } catch {
    /* no manifest is a safe answer */
  }
  return new Response('Not found', { status: 404 });
}
