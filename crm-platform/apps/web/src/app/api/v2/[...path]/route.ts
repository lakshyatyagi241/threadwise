import { proxyRequest } from '@/lib/auth/proxy';

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyRequest(req, path, 'user');
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
