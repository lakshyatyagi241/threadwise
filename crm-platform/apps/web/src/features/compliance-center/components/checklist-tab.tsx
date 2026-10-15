'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ChecklistItem } from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { useComplianceChecklist } from '../api/hooks';
import { errorKey, type ErrorKey } from '../lib/errors';
import { STATUS_TONE } from '../lib/model';
import { CARD } from './fields';

/**
 * Each baseline point and each requirement of a switched-on profile as built, partial or open, worked out from what the workspace has
 * set up. The words say which tools are in place: they never say the workspace complies with a law.
 */
export function ChecklistTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const t = useTranslations('compliance-center');
  const q = useComplianceChecklist(true);

  if (q.isError) {
    return (
      <Alert tone="danger" className="flex items-center justify-between gap-3">
        <span>{t(`errors.${errorKey(q.error) satisfies ErrorKey}`)}</span>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </Alert>
    );
  }
  if (!q.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }
  const { items, summary } = q.data;
  const baseline = items.filter((i) => i.scope === 'baseline');
  const profile = items.filter((i) => i.scope === 'profile');
  return (
    <div className="space-y-4" data-testid="checklist">
      <p className="text-sm text-muted-foreground">{t('checklist.intro')}</p>
      <div className="flex flex-wrap gap-2" aria-label={t('checklist.summaryLabel')}>
        {(['built', 'partial', 'open'] as const).map((s) => (
          <Badge key={s} tone={STATUS_TONE[s]} data-testid={`summary-${s}`}>
            {t('checklist.summary', { status: t(`checklist.status.${s}`), count: summary[s] })}
          </Badge>
        ))}
      </div>
      <Section title={t('checklist.baselineTitle')} hint={t('checklist.baselineHint')}>
        {baseline.map((i) => (
          <Row key={i.id} item={i} onOpenTab={onOpenTab} />
        ))}
      </Section>
      {profile.length > 0 ? (
        <Section title={t('checklist.profileTitle')} hint={t('checklist.profileHint')}>
          {profile.map((i) => (
            <Row key={i.id} item={i} onOpenTab={onOpenTab} />
          ))}
        </Section>
      ) : (
        <Alert>{t('checklist.noProfiles')}</Alert>
      )}
      <p className="text-xs text-muted-foreground">{t('checklist.disclaimer')}</p>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <ul className="mt-3 divide-y divide-border">{children}</ul>
    </section>
  );
}

function Row({ item, onOpenTab }: { item: ChecklistItem; onOpenTab: (tab: string) => void }) {
  const t = useTranslations('compliance-center');
  const tab = item.href?.startsWith('/compliance?tab=')
    ? item.href.slice('/compliance?tab='.length)
    : null;
  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      data-testid={`row-${item.id}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t(`checklist.items.${item.id}.title`)}</span>
          {item.regimes.map((r) => (
            <Badge key={r}>{t(`profiles.items.${r}.name`)}</Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`checklist.items.${item.id}.detail.${item.detail}`, item.params)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={STATUS_TONE[item.status]} data-testid={`status-${item.id}`}>
          {t(`checklist.status.${item.status}`)}
        </Badge>
        {tab ? (
          <Button size="sm" variant="secondary" onClick={() => onOpenTab(tab)}>
            {t('checklist.open')}
          </Button>
        ) : item.href ? (
          <Link
            href={item.href}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {t('checklist.open')}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
