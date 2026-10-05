'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SecurityOverviewResponse } from '@crm/contracts';
import { Badge, Card, cn } from '@crm/ui';
import { enforcementTone } from '../lib/enforcement';
import {
  coverageText,
  coverageTone,
  formatPercent,
  formatRelativeTime,
  kpiAccents,
  mfaCoveragePercent,
  scoreState,
  severityTone,
  webhookState,
  type KpiAccent,
  type KpiTone,
  type MeterTone,
} from '../lib/kpi';
import { riskRowTone, seeAllRisksHref, shapeRisk, type RiskOwner } from '../lib/risks';
import type { DangerKind } from '../lib/danger';
import { useOperator } from '../operator-context';
import { SECURITY_NS } from './policy-form';

const TONE_TEXT: Record<MeterTone, string> = {
  success: 'text-success',
  primary: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
};
const TONE_BAR: Record<MeterTone, string> = {
  success: 'bg-success',
  primary: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const BORDER: Record<KpiTone, string> = {
  success: 'border-success/50',
  warning: 'border-warning/40',
  danger: 'border-danger/40',
};
const TEXT: Record<KpiTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

function Kpi({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent: KpiAccent;
}) {
  return (
    <Card className={cn('space-y-2 p-4', accent.border && BORDER[accent.border])}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-3xl font-semibold leading-none tracking-tight',
          accent.value && TEXT[accent.value],
        )}
      >
        {value}
      </dd>
      <dd className={cn('text-xs', accent.note ? TEXT[accent.note] : 'text-muted-foreground')}>
        {note}
      </dd>
    </Card>
  );
}

/** The six always-visible numbers at the top of the Security Center. */
export function KpiStrip({ kpis }: { kpis: SecurityOverviewResponse['kpis'] }) {
  const t = useTranslations(`${SECURITY_NS}.kpis`);
  const locale = useLocale();
  const state = scoreState(kpis.score);
  const hooks = webhookState(kpis.webhookFailurePct);
  const accent = kpiAccents(kpis);
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi
        label={t('score.label')}
        value={String(kpis.score)}
        note={t(`score.${state}`)}
        accent={accent.score}
      />
      <Kpi
        label={t('openRisks.label')}
        value={String(kpis.openRisks)}
        note={t('openRisks.note', { count: kpis.highPriorityRisks })}
        accent={accent.openRisks}
      />
      <Kpi
        label={t('blocked.label')}
        value={String(kpis.blockedAttempts24h)}
        note={t('last24h')}
        accent={accent.blocked}
      />
      <Kpi
        label={t('warnings.label')}
        value={String(kpis.warnings24h)}
        note={t('last24h')}
        accent={accent.warnings}
      />
      <Kpi
        label={t('mfa.label')}
        value={`${mfaCoveragePercent(kpis.operatorMfa.enrolled, kpis.operatorMfa.total)}%`}
        note={t('mfa.note', { enrolled: kpis.operatorMfa.enrolled, total: kpis.operatorMfa.total })}
        accent={accent.mfa}
      />
      <Kpi
        label={t('webhooks.label')}
        value={`${formatPercent(kpis.webhookFailurePct, locale)}%`}
        note={t(`webhooks.${hooks}`)}
        accent={accent.webhooks}
      />
    </dl>
  );
}

const ROW_TINT = { danger: 'bg-danger/5', warning: 'bg-warning/5' } as const;

function OwnerText({ owner }: { owner: RiskOwner }) {
  const t = useTranslations(`${SECURITY_NS}.risks.owner`);
  switch (owner.kind) {
    case 'name':
      return owner.name;
    case 'system':
      return t('system');
    case 'type':
      return t(`types.${owner.type}`);
  }
}

/** The priority queue: severity, signal, workspace, owner and an Inspect link per row, as a table that scrolls sideways on a phone. */
function RiskQueue({
  risks,
  appName,
}: {
  risks: SecurityOverviewResponse['risks'];
  appName: string;
}) {
  const t = useTranslations(`${SECURITY_NS}.risks`);
  const shellBrand = useTranslations('auth-registration-security.platform.shell')('brand');
  const brand = appName.trim() || shellBrand;
  const locale = useLocale();
  const [now] = useState(() => Date.now());
  const rows = risks.map(shapeRisk);
  const th = 'px-3 py-2.5 text-start font-medium';
  return (
    <Card className="overflow-hidden p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </p>
          <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
        </div>
        <Link
          href={seeAllRisksHref()}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('seeAll')}
        </Link>
      </header>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={cn(th, 'w-28 ps-4')}>
                {t('columns.severity')}
              </th>
              <th scope="col" className={th}>
                {t('columns.signal')}
              </th>
              <th scope="col" className={cn(th, 'w-40')}>
                {t('columns.workspace')}
              </th>
              <th scope="col" className={cn(th, 'w-36')}>
                {t('columns.owner')}
              </th>
              <th scope="col" className={cn(th, 'w-24 pe-4 text-end')}>
                {t('columns.action')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const tone = riskRowTone(r.severity);
                return (
                  <tr key={`${r.signal}-${r.at}-${i}`} className={cn(tone && ROW_TINT[tone])}>
                    <td className="py-3 ps-4 pe-3 align-top">
                      <Badge tone={severityTone(r.severity)} className="font-mono text-[11px]">
                        {t(`severity.${r.severity}`)}
                      </Badge>
                    </td>
                    <td className="max-w-0 px-3 py-3 align-top">
                      <div className="break-words font-semibold" dir="ltr">
                        {r.signal}
                      </div>
                      {r.detail && (
                        <div
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={r.detail}
                          dir="ltr"
                        >
                          {r.detail}
                        </div>
                      )}
                      <time dateTime={r.at} className="text-xs text-muted-foreground">
                        {formatRelativeTime(r.at, now, locale)}
                      </time>
                    </td>
                    <td className="px-3 py-3 align-top font-semibold">
                      {r.workspace.kind === 'name' ? (
                        r.workspace.name
                      ) : r.workspace.kind === 'platform' ? (
                        t('platformOf', { app: brand })
                      ) : (
                        <span aria-label={t('noWorkspace')} className="text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-muted-foreground">
                      <OwnerText owner={r.owner} />
                    </td>
                    <td className="py-3 ps-3 pe-4 text-end align-top">
                      <Link
                        href={r.inspectHref}
                        className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {t('inspect')}
                        <span className="sr-only"> {r.signal}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CoverageCard({ coverage }: { coverage: SecurityOverviewResponse['coverage'] }) {
  const t = useTranslations(`${SECURITY_NS}.coverage`);
  const locale = useLocale();
  return (
    <Card className="space-y-4">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('kicker')}
        </p>
        <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
      </header>
      <ul className="space-y-3 text-sm">
        {coverage.map((c) => {
          const tone = coverageTone(c.percent);
          return (
            <li key={c.key}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span id={`coverage-${c.key}`}>{t(`buckets.${c.key}`)}</span>
                <span className={cn('font-mono text-xs', TONE_TEXT[tone])}>
                  {coverageText(c, locale)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-labelledby={`coverage-${c.key}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={c.percent}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn('h-full rounded-full', TONE_BAR[tone])}
                  style={{ width: `${c.percent}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function QuickActions({
  halted,
  onAction,
}: {
  halted: boolean;
  onAction: (kind: DangerKind) => void;
}) {
  const t = useTranslations(`${SECURITY_NS}.quickActions`);
  const { canRunDanger } = useOperator();
  const row =
    'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-start text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <Card className="space-y-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('kicker')}
      </p>
      <div className="space-y-2">
        <button
          type="button"
          className={cn(row, 'border-border')}
          disabled={!canRunDanger}
          onClick={() => onAction('rotate_webhook_secrets')}
        >
          {t('rotate')}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {t('scopeAll')}
          </span>
        </button>
        <button
          type="button"
          className={cn(row, 'border-border')}
          disabled={!canRunDanger}
          onClick={() => onAction('force_password_reset')}
        >
          {t('forceReset')}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {t('scopeUsers')}
          </span>
        </button>
        {halted ? (
          <button
            type="button"
            className={cn(row, 'border-success/40 bg-success/10 text-success hover:bg-success/15')}
            disabled={!canRunDanger}
            onClick={() => onAction('resume_sends')}
          >
            {t('resume')}
            <span className="font-mono text-[11px] font-normal">{t('halted')}</span>
          </button>
        ) : (
          <button
            type="button"
            className={cn(row, 'border-danger/40 bg-danger/5 text-danger hover:bg-danger/10')}
            disabled={!canRunDanger}
            onClick={() => onAction('halt_sends')}
          >
            {t('halt')}
            <span className="font-mono text-[11px] font-normal">{t('scopeGlobal')}</span>
          </button>
        )}
      </div>
      {!canRunDanger && <p className="text-xs text-muted-foreground">{t('superAdminOnly')}</p>}
    </Card>
  );
}

/** What every control really does today, straight from the API's enforcement matrix. */
function EnforcementTable({ matrix }: { matrix: SecurityOverviewResponse['enforcement'] }) {
  const t = useTranslations(`${SECURITY_NS}.enforcement`);
  return (
    <Card className="p-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:ring-primary">
          <span>
            <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('kicker')}
            </span>
            <span className="block text-lg font-semibold leading-tight">{t('title')}</span>
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 rounded-md border border-border px-3 py-1 text-sm"
          >
            <span className="group-open:hidden">{t('show')}</span>
            <span className="hidden group-open:inline">{t('hide')}</span>
          </span>
        </summary>
        <div className="border-t border-border px-4 py-3">
          <p className="mb-3 text-sm text-muted-foreground">{t('description')}</p>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.control')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.consumer')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {matrix.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2 pe-3 align-top">
                      <div className="font-medium">{row.key}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {row.controls.join(' · ')}
                      </div>
                    </td>
                    <td className="py-2 pe-3 align-top text-muted-foreground">{row.consumer}</td>
                    <td className="py-2 align-top">
                      <Badge tone={enforcementTone(row.status)}>{t(row.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </Card>
  );
}

export function SummaryPanel({
  overview,
  onAction,
}: {
  overview: SecurityOverviewResponse;
  onAction: (kind: DangerKind) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <RiskQueue risks={overview.risks} appName={overview.appName} />
        <aside className="space-y-5">
          <CoverageCard coverage={overview.coverage} />
          <QuickActions halted={overview.emergencyHalt} onAction={onAction} />
        </aside>
      </div>
      <EnforcementTable matrix={overview.enforcement} />
    </div>
  );
}
