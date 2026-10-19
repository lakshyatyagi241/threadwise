import { proxyWidget } from '@/lib/widget-proxy';

async function handler(req: Request, ctx: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await ctx.params;
  return proxyWidget(req, ['widget', token, ...path]);
}

export { handler as GET, handler as POST, handler as OPTIONS, handler as HEAD };
