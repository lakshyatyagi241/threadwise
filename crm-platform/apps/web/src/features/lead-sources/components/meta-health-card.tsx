'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Card } from '@crm/ui';
import { useMetaHealth } from '../meta-api';
import { ROUTES } from '../lib/source-view';
import { AccessChip, SyncChip } from './meta-chips';
import { ErrorText, Loading, When } from './ui';

/**
 * "Meta lead form health" on the page of a source made by picking a Meta lead form: which Page and form it reads, whether Meta is
 * delivering (lead sync state and lead access), the last lead and the last error, and the way to fix it, which is the Ads tab.
 */
export function MetaHealthCard({ sourceId, enabled }: { sourceId: string; enabled: boolean }) {
  const t = useTranslations('lead-sources.meta.health');
  const q = useMetaHealth(sourceId, enabled);

  let body;
  if (q.isPending) {
    body = <Loading label={t('loading')} />;
  } else if (q.isError) {
    body = <ErrorText error={q.error} onRetry={() => void q.refetch()} />;
  } else if (!q.data.connected) {
    body = (
      <Alert tone="warning" data-testid="meta-health-disconnected">
        {t('notConnected')}
      </Alert>
    );
  } else {
    const h = q.data;
    const needsFix =
      h.state === 'needs_lead_access' ||
      h.state === 'needs_reconnect' ||
      h.state === 'error' ||
      h.state === 'off' ||
      h.lastError !== null;
    body = (
      <>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="meta-health">
          <Fact label={t('page')}>
            <span dir="auto">{h.pageName ?? h.pageId ?? '-'}</span>
          </Fact>
          <Fact label={t('form')}>
            <span dir="auto">{h.formName ?? h.formId ?? '-'}</span>
          </Fact>
          <Fact label={t('state')}>
            {h.state ? (
              <SyncChip state={h.state} />
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </Fact>
          <Fact label={t('leadAccess')}>
            {h.leadAccess ? (
              <AccessChip access={h.leadAccess} />
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </Fact>
          <Fact label={t('lastLead')}>
            <When value={h.lastLeadAt} empty={t('never')} />
          </Fact>
        </dl>
        {h.lastError && (
          <Alert tone="danger" className="text-xs" data-testid="meta-health-error">
            <span className="font-medium">{t('lastError')}</span>{' '}
            <span dir="auto">{h.lastError}</span>
          </Alert>
        )}
        {needsFix && <p className="text-sm text-muted-foreground">{t('fixHint')}</p>}
      </>
    );
  }

  return (
    <Card className="space-y-3 p-5" data-testid="meta-health-card">
      <h3 className="text-base font-semibold">{t('title')}</h3>
      {body}
      <Link
        href={ROUTES.ads}
        className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {t('openAds')}
      </Link>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
