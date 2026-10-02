import { proxyRequest } from '@/lib/auth/proxy';

/**
 * A message attachment for the browser: the API route through the session proxy, with the headers the proxy does not relay.
 * Images show inline; every other type downloads, under a name taken from `?name=` (cleaned, only a download hint). A sandboxed
 * content policy keeps a browser from running anything it finds in the file.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const upstream = await proxyRequest(req, ['team-chat', 'messages', id, 'attachment'], 'user');
  if (!upstream.ok) return upstream;

  const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const name = cleanName(new URL(req.url).searchParams.get('name'));
  const headers = new Headers(upstream.headers);
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, max-age=3600');
  headers.set(
    'content-disposition',
    `${type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  return new Response(upstream.body, { status: upstream.status, headers });
}

function cleanName(raw: string | null): string {
  const base = (raw ?? '').split(/[/\]/).pop() ?? '';
  const kept = [...base].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && c !== '"');
  return (kept.join('').trim() || 'file').slice(0, 191);
}
