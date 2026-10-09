'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, Spinner } from '@crm/ui';
import { useIntegrationsSummary } from './api';

const NS = 'admin-console-shell.workspaceSettings.api';

/**
 * TW-ASHELL-042: the informational "API and webhooks" pane, with no controls of its own: the Sheets add-on key status
 * (masked, never the secret), the REST API notes and the webhook counts. Counts read as 0 when they cannot be loaded, as in
 * Reference. The Webhooks and Sheets links go to the pages that exist today (Integrations, Account).
 */
export function ApiTab() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const q = useIntegrationsSummary();
  const key = q.data?.sheetsKey ?? null;
  const when = (iso: string | null) => (iso ? f.relativeTime(new Date(iso)) : t('never'));
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl">{t('sheetsTitle')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('sheetsBody')}</p>
          </div>
          <Link
            href="/account"
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            {t('manageInAccount')}
          </Link>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : key ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="sheets-key">
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-mono text-[10px] uppercase text-success">
              {t('active')}
            </span>
            <code className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs">
              wsn_live_••••{key.suffix}
            </code>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('keyTimes', { created: when(key.createdAt), used: when(key.lastUsedAt) })}
            </span>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
            {t('noKey')}{' '}
            <Link href="/account" className="font-semibold text-primary hover:underline">
              {t('noKeyLink')}
            </Link>
          </p>
        )}
      </Card>
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
