import type { CmsPage } from '@crm/contracts';
import { loadExtras } from '../public/load';
import { makeFc, sectionsFor, type SiteContent } from './content';
import { SectionView, type SiteCtx } from './site-ui';

/** One marketing page: its sections in the saved order, hidden ones left out (WD-CMS-009). */
export async function SitePage({
  page,
  content,
  edit = false,
}: {
  page: CmsPage;
  content: SiteContent;
  edit?: boolean;
}) {
  const ctx: SiteCtx = { fc: makeFc(content.values), edit, page, extras: await loadExtras(page) };
  return (
    <>
      {sectionsFor(page, content).map((slug) => (
        <SectionView key={slug} ctx={ctx} slug={slug} />
      ))}
    </>
  );
}
