import { forwardPublicPost } from '@/features/storefront-builder/public/api/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return forwardPublicPost(req, slug, 'abandon');
}
