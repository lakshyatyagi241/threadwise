'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  CONFERENCING_APP_SLUG,
  conferencingOperatorStatusSchema,
  type ConferencingGap,
  type ConferencingOperatorProvider,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { Alert, Badge } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** The environment values each provider reads, shown literally: they are names the operator types, not words to translate. */
export const ENV_NAMES: Record<ConnectedVideoProvider, { id: string; secret: string }> = {
  zoom: { id: 'ZOOM_CLIENT_ID', secret: 'ZOOM_CLIENT_SECRET' },
  teams: { id: 'TEAMS_CLIENT_ID', secret: 'TEAMS_CLIENT_SECRET' },
};

/** The provider whose listing this slug is, or null for any other listing. */
export function conferencingProviderOf(slug: string): ConnectedVideoProvider | null {
  const found = (
    Object.entries(CONFERENCING_APP_SLUG) as Array<[ConnectedVideoProvider, string]>
  ).find(([, s]) => s === slug);
  return found ? found[0] : null;
}

/** Whether a gap is an unmet step, in the words of the checklist's rows. */
export const hasGap = (p: ConferencingOperatorProvider, gap: ConferencingGap): boolean =>
  p.gaps.includes(gap);

const fetchStatus = (signal?: AbortSignal) =>
  operatorFetch('/conferencing/status', { schema: conferencingOperatorStatusSchema, signal });

function Row({ ok, label, children }: { ok: boolean; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <Badge tone={ok ? 'success' : 'warning'}>{ok ? '✓' : '!'}</Badge>
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="font-medium">{label}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Operator console, on the listing page of Zoom and Microsoft Teams: what is still missing before a workspace can install and use it.
 * Read-only. It reads the same sources the connect flow uses, so "ready" here means a person can connect. It shows whether a value is set,
 * never the value, and the exact address to register at the provider.
 */
export function ConferencingSetupPanel({ slug }: { slug: string }) {
  const provider = conferencingProviderOf(slug);
  const t = useTranslations('meeting-conferencing.operator');
  const q = useQuery({
    queryKey: ['operator', 'conferencing-status'],
    queryFn: ({ signal }) => fetchStatus(signal),
    enabled: provider !== null,
    refetchOnWindowFocus: true,
  });
  if (!provider) return null;
  const p = q.data?.providers.find((x) => x.provider === provider);
  if (q.isPending) return null;
  if (q.isError || !p) {
    return (
      <Alert tone="warning">
        <p>{t('loadFailed')}</p>
      </Alert>
    );
  }
  const names = ENV_NAMES[provider];
  const credsOk = p.hasClientId && p.hasClientSecret && !p.switchedOff;
  return (
    <section
      aria-label={t('title')}
      className="space-y-2 rounded-2xl border border-border bg-background p-4"
      data-testid="conferencing-setup"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Badge tone={p.ready ? 'success' : 'warning'}>
          {p.ready ? t('ready') : t('missing', { count: p.gaps.length })}
        </Badge>
      </header>
      <p className="text-sm text-muted-foreground">{t(`intro.${provider}`)}</p>
      {q.data?.fakeAdapters && (
        <Alert tone="info">
          <p>{t('fake')}</p>
        </Alert>
      )}
      <ul className="divide-y divide-border">
        <Row ok={credsOk} label={t(`credentials.${provider}.label`)}>
          <p>
            <code dir="ltr" className="font-mono text-xs">
              {names.id}
            </code>
            : {p.hasClientId ? t('set') : t('notSet')}
          </p>
          <p>
            <code dir="ltr" className="font-mono text-xs">
              {names.secret}
            </code>
            : {p.hasClientSecret ? t('set') : t('notSet')}
          </p>
          {provider === 'teams' && <p>{t('teamsFallback')}</p>}
          {p.credentialsSource !== 'none' && <p>{t(`source.${p.credentialsSource}`)}</p>}
          {p.switchedOff && <p className="text-danger">{t('switchedOff')}</p>}
        </Row>
        <Row ok label={t('redirect.label')}>
          <p>{t(`redirect.hint.${provider}`)}</p>
          <p>
            <code dir="ltr" className="break-all font-mono text-xs" data-testid="redirect-uri">
              {p.redirectUri}
            </code>
          </p>
        </Row>
        <Row ok={p.listing.published} label={t('listing.label')}>
          {!p.listing.exists && <p>{t('listing.missing')}</p>}
          {p.listing.exists && !p.listing.published && (
            <p>{t('listing.notPublished', { status: p.listing.status ?? '' })}</p>
          )}
          {p.listing.published && <p>{t('listing.published')}</p>}
        </Row>
      </ul>
    </section>
  );
}
