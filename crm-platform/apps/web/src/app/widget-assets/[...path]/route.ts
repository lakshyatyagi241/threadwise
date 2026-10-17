import { proxyWidget } from '@/lib/widget-proxy';

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyWidget(req, ['widget-assets', ...path]);
}

export { handler as GET, handler as HEAD };
