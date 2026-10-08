'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { setExportResponseSchema, setHubResponseSchema } from '@crm/contracts';
import { Badge, Button, Card, Input, Spinner, StatTile } from '@crm/ui';
import { tileMatches } from '@/features/admin-console-shell/tile-search';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { EXTERNAL_CARDS, GROUP_SPECS, HUB_ORDER } from '../fields';
import { exportFileName } from '../lib/export-name';
import { hubKey } from '../lib/query-keys';
import { SetHeader } from './page-parts';

const NS = 'platform-settings-branding-storage';

const linkButton =
  'inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted';

/** The settings landing page (TW-SET-003): header actions, five numbers, then one numbered card per settings page. */
export function SettingsHubPage() {
  const t = useTranslations(NS);
  const tn = useTranslations(`${NS}.hub`);
  const tc = useTranslations(`${NS}.cards`);
  const ts = useTranslations('admin-console-shell.hubSearch');
  const [search, setSearch] = useState('');
  const format = useFormatter();
  const toast = useToast();
  const { operator } = useOperator();
  const q = useQuery({
    queryKey: hubKey,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/groups', { schema: setHubResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });

  const exporting = useMutation({
    mutationFn: () => operatorFetch('/settings/export', { schema: setExportResponseSchema }),
    onSuccess: (out) => {
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = exportFileName(out.app, new Date(out.exportedAt));
      a.click();
      URL.revokeObjectURL(href);
    },
    onError: () => toast.error(t('common.unexpected')),
  });

  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const { kpis, groups } = q.data;
  const state = new Map(groups.map((g) => [g.group, g]));
  const specs = new Map(GROUP_SPECS.map((s) => [s.id, s]));
  const external = new Map<string, string>(EXTERNAL_CARDS.map((c) => [c.id, c.href]));
  const shown = (id: (typeof HUB_ORDER)[number]) =>
    tileMatches(`${tc(`${id}.title`)} ${tc(`${id}.description`)} ${tc(`${id}.tags`)}`, search);

  return (
    <div className="space-y-6">
      <SetHeader
        eyebrow={tn('kicker')}
        title={tn('title')}
        description={tn('description')}
        actions={
          <>
            <Link href="/admin/extensions" className={linkButton}>
              {tn('actions.addons')}
            </Link>
            <Link href="/admin/system" className={linkButton}>
              {tn('actions.updater')}
            </Link>
            <Link href="/admin/legal-pages" className={linkButton}>
              {tn('actions.legal')}
            </Link>
            <Link href="/admin/settings/general" className={linkButton}>
              {tn('actions.general')}
            </Link>
            {operator.role === 'super_admin' && (
              <Button onClick={() => exporting.mutate()} disabled={exporting.isPending}>
                {exporting.isPending && <Spinner label={tn('exporting')} />}
                {exporting.isPending ? tn('exporting') : tn('export')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label={tn('tiles.saved')}
          value={kpis.savedGroups}
          hint={tn('tiles.savedHint', { total: kpis.totalGroups })}
        />
        <StatTile
          label={tn('tiles.healthy')}
          value={kpis.healthyGroups}
          tone={kpis.healthyGroups > 0 ? 'accent' : 'default'}
          hint={tn('tiles.healthyHint')}
        />
        <StatTile
          label={tn('tiles.needsTest')}
          value={kpis.needsTest.length}
          tone={kpis.needsTest.length > 0 ? 'warning' : 'default'}
          hint={
            kpis.needsTest.length > 0
              ? kpis.needsTest.map((g) => t(`groups.${g}.title`)).join(', ')
              : tn('tiles.needsTestNone')
          }
        />
        <StatTile
          label={tn('tiles.secrets')}
          value={kpis.secretFields}
          hint={tn('tiles.secretsHint')}
        />
        <StatTile
          label={tn('tiles.lastUpdated')}
          value={
            <span className="text-lg">
              {kpis.lastUpdatedAt
                ? format.relativeTime(new Date(kpis.lastUpdatedAt))
                : tn('tiles.lastUpdatedNone')}
            </span>
          }
          hint={tn('tiles.lastUpdatedHint')}
        />
      </div>

      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={ts('placeholder')}
        aria-label={ts('placeholder')}
        className="max-w-md"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {HUB_ORDER.map((id, i) => {
          const spec = specs.get(id);
          const href = spec ? `/admin/settings/${spec.slug}` : external.get(id);
          if (!href) return null;
          if (!shown(id)) return null;
          const s = spec ? state.get(spec.group) : undefined;
          return (
            <Link
              key={id}
              href={href}
              data-testid={`hub-card-${id}`}
              className="rounded-md focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Card className="flex h-full flex-col gap-2 transition-colors hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold leading-tight">{tc(`${id}.title`)}</h2>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{tc(`${id}.description`)}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {tc(`${id}.tags`)}
                  </span>
                  <span className="flex items-center gap-2">
                    {s?.needsTest ? (
                      <Badge tone="warning">{tn('card.needsTest')}</Badge>
                    ) : s ? (
                      <Badge tone={s.saved ? 'success' : 'neutral'}>
                        {s.saved ? tn('card.saved') : tn('card.defaults')}
                      </Badge>
                    ) : null}
                    <span className="font-mono text-[11px] text-primary">{tn('card.open')}</span>
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      {!HUB_ORDER.some(shown) && <p className="text-sm text-muted-foreground">{ts('empty')}</p>}
      <p className="text-sm text-muted-foreground">{tn('others')}</p>
    </div>
  );
}
