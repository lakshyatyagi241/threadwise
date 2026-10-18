'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@crm/ui';
import { useIntegrationsSummary } from './api';

const NS = 'admin-console-shell.workspaceSettings.api';

/**
 * TW-ASHELL-042: the informational "API and webhooks" pane, with no controls of its own: the REST API notes and the
 * webhook counts. Counts read as 0 when they cannot be loaded, as in Reference. The Webhooks link goes to the page that exists
 * today (Integrations).
 */
export function ApiTab() {
  const t = useTranslations(NS);
  const q = useIntegrationsSummary();
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-6">
        <h2 className="font-serif text-xl">{t('restTitle')}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('rest1')}</li>
          <li>{t('rest2')}</li>
          <li>{t('rest3')}</li>
        </ul>
      </Card>
      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl">{t('webhooksTitle')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('webhooksBody')}</p>
          </div>
          <Link
            href="/integrations"
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            {t('manage')}
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['outbound', 'inbound'] as const).map((k) => (
            <div key={k} className="rounded-xl border border-border p-4" data-testid={`count-${k}`}>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t(`${k}Title`)}
              </div>
              <div className="mt-1 font-serif text-3xl leading-none">
                {q.data?.webhooks[k] ?? 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t(`${k}Body`)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
