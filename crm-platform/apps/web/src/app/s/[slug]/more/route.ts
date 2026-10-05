import { forwardPublicHome } from '@/features/storefront-builder/public/api/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return forwardPublicHome(req, slug);
}
