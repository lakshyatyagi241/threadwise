import { apiBase } from '@/lib/auth/server';

/** robots.txt (WD-SET-028): the API builds it from the SEO and General settings, this only serves it. */
export async function GET() {
  try {
    const res = await fetch(`${apiBase()}/v2/public/robots.txt`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      return new Response(await res.text(), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
  } catch {
    /* fall through to the safe default */
  }
  return new Response('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
