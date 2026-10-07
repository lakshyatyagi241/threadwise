import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { DeveloperProviders } from '../../components/providers';
import type { DocsData } from '../lib/load-spec';
import { AuthCard, CARD, Capabilities, Footer, Hero, Topbar, WebhooksCard } from './docs-parts';
import { DocsShell } from './docs-shell';

/** What takes the endpoint reference's place when there is nothing to list: the API is unreachable, or it has no endpoints yet. */
function Notice({ kind }: { kind: 'unavailable' | 'empty' }) {
  const t = useTranslations('developer-rest-api-v1-docs.reference');
  if (kind === 'empty') {
    return (
      <section className={cn(CARD, 'text-center text-muted-foreground')}>
        <p>{t('empty')}</p>
      </section>
    );
  }
  return (
    <section role="alert" className={cn(CARD, 'text-center')}>
      <p className="font-semibold text-danger">{t('unavailableTitle')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('unavailableBody')}</p>
      {/* A plain link, not client navigation: it must reload the page so the server asks the API again. */}
      <a
        href="/developers/docs"
        className="mt-3 inline-flex rounded-full border border-border px-3.5 py-2 text-xs font-semibold hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('retry')}
      </a>
    </section>
  );
}

/**
 * `/developers/docs` (WD-API-149), public: top bar, sidebar, introduction cards and the endpoint reference built from the OpenAPI
 * document. Server-rendered; only the filter and the open/close of a card run in the browser.
 */
export function DocsPage({
  data,
  brand,
  baseUrl,
  specUrl,
}: {
  data: DocsData;
  brand: string;
  baseUrl: string;
  specUrl: string;
}) {
  const reference = data.status === 'ok' ? data.reference : null;
  return (
    <DeveloperProviders>
      <Topbar brand={brand} specUrl={specUrl} />
      <DocsShell
        reference={reference}
        intro={
          <>
            <Hero brand={brand} baseUrl={baseUrl} />
            <Capabilities />
            <AuthCard />
            <WebhooksCard />
          </>
        }
        notice={<Notice kind={data.status === 'empty' ? 'empty' : 'unavailable'} />}
        footer={<Footer brand={brand} />}
      />
    </DeveloperProviders>
  );
}
