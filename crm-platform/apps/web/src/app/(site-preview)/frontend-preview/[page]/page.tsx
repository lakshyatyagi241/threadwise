import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isCmsPage, operatorContentResponseSchema } from '@crm/contracts';
import { contentFromEntries } from '@/features/marketing-site-cms/site/content';
import { SiteFrame } from '@/features/marketing-site-cms/site/site-frame';
import { SitePage } from '@/features/marketing-site-cms/site/site-page';
import { cookieNames } from '@/lib/auth/cookies';
import { apiBase, getOperatorSession } from '@/lib/auth/server';
import { upstreamFetch } from '@/lib/auth/upstream';

export const dynamic = 'force-dynamic';

/**
 * The editor's live preview (TW-CMS-018): the page as it would look if every draft were published. Only a signed-in
 * platform operator can open it; public pages never read drafts. The editor shell embeds this page and edits it in place.
 */
export default async function PreviewPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!isCmsPage(page)) notFound();
  const { session } = await getOperatorSession();
  if (!session) redirect('/admin/login');
  const token = (await cookies()).get(cookieNames('operator').access)?.value;
  const res = await upstreamFetch(`${apiBase()}/v2/platform/cms/content`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
  const parsed = operatorContentResponseSchema.safeParse(res.ok ? await res.json() : null);
  if (!parsed.success) notFound();
  const content = contentFromEntries(parsed.data.entries, parsed.data.homepageEnabled, '');
  return (
    <SiteFrame content={content} current={page === 'home' ? '/' : `/${page}`} edit>
      <SitePage page={page} content={content} edit />
    </SiteFrame>
  );
}
