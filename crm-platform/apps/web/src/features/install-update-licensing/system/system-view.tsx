'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  systemStatusResponseSchema,
  verifyLicenceResponseSchema,
  type SystemStatusResponse,
} from '@crm/contracts';
import { Alert, Badge, Button, Input, cn } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { ApiError } from '@/lib/api/errors';
import { checkTone, formatUptime, migrationStatusTone, rowTone } from './system-format';

const NS = 'install-update-licensing.system';
const QUERY_KEY = ['operator', 'system'] as const;

/** Section frame of WaDesk's updater page: mono kicker, serif title, hairline under the header. */
function Section({
  kicker,
  title,
  badge,
  actions,
  children,
}: {
  kicker: string;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        {badge}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground rtl:font-sans rtl:tracking-normal">
            {kicker}
          </div>
          <h2 className="mt-0.5 font-serif text-[22px] leading-tight">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
        done ? 'bg-primary/20 text-brand' : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </div>
  );
}

/** Step 1 of WaDesk's updater (WD-INST-020): the purchase code. Only a deployment that enforces one shows a form. */
function LicenceCard({ data }: { data: SystemStatusResponse }) {
  const t = useTranslations(`${NS}.licence`);
  const locale = useLocale();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const [code, setCode] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { required, verified, verifiedAt } = data.licence;
  const canVerify = operator.role === 'super_admin';

  const verify = useMutation({
    mutationFn: () =>
      operatorFetch('/system/licence', {
        method: 'POST',
        body: { purchaseCode: code.trim() },
        schema: verifyLicenceResponseSchema,
      }),
    onSuccess: () => {
      setReason(null);
      setMessage(t('verified'));
      setCode('');
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => {
      setMessage(null);
      setReason(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? 'unknown') : 'unknown');
    },
  });

  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  return (
    <Section
      kicker={t('kicker')}
      title={t('title')}
      badge={<StepBadge n={1} done={required && verified} />}
    >
      {!required ? (
        <p className="max-w-2xl text-[12.5px] text-muted-foreground">{t('notEnabled')}</p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() && canVerify && !verify.isPending) verify.mutate();
          }}
        >
          <p className="max-w-2xl text-[12.5px] text-muted-foreground">{t('intro')}</p>
          <div className="mt-3 flex max-w-xl flex-col gap-2 sm:flex-row">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={verified && !code ? t('mask') : t('placeholder')}
              aria-label={t('title')}
              autoComplete="off"
              spellCheck={false}
              disabled={!canVerify}
              className="h-9 flex-1 rounded-full bg-muted px-4 text-[12.5px] focus-visible:bg-background focus-visible:ring-1"
            />
            <Button
              type="submit"
              variant="brand"
              className="h-9 shrink-0 rounded-full px-5 text-[12px] font-semibold hover:bg-primary hover:opacity-100"
              disabled={!canVerify || !code.trim() || verify.isPending}
            >
              {verify.isPending ? t('verifying') : t('verify')}
            </Button>
          </div>
          <div aria-live="polite" className="mt-2 text-[12px]">
            {reason && <p className="text-danger">{t(`reasons.${reason}`)}</p>}
            {message && <p className="text-success">{message}</p>}
            {!reason && !message && (
              <p className="text-muted-foreground">
                {verified && verifiedAt
                  ? t('verifiedAt', { date: when.format(new Date(verifiedAt)) })
                  : t('notVerified')}
              </p>
            )}
            {!canVerify && <p className="text-muted-foreground">{t('superAdminOnly')}</p>}
          </div>
        </form>
      )}
    </Section>
  );
}

/** WaDesk's five numbered updater steps, as what they are in a container deploy. Information, not controls. */
function ProcessCard() {
  const t = useTranslations(`${NS}.process`);
  return (
    <Section kicker={t('kicker')} title={t('title')}>
      <ol className="space-y-3">
        {([2, 3, 4, 5] as const).map((n) => (
          <li key={n} className="flex items-center gap-3 rounded-2xl border border-border p-4">
            <StepBadge n={n} />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">{t(`step${n}.title`)}</p>
              <p className="text-[12px] text-muted-foreground">{t(`step${n}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Updater page (WD-INST-019, -025, -027): version and build, licence, health and the migration ledger. */
export function SystemView() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/system', { schema: systemStatusResponseSchema, signal }),
  });
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
    [locale],
  );
  const stamp = (iso: string | null) => (iso ? when.format(new Date(iso)) : t('release.none'));
  const data = q.data;

  return (
    <div className="space-y-5">
      <nav
        aria-label="breadcrumb"
        className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground"
      >
        <Link href="/admin" className="uppercase tracking-[0.16em] hover:text-foreground">
          {t('crumbAdmin')}
        </Link>
        <span aria-hidden="true">›</span>
        <Link href="/admin/settings" className="hover:text-foreground">
          {t('crumbSettings')}
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-foreground" aria-current="page">
          {t('crumbUpdater')}
        </span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="font-serif text-[28px] font-normal leading-none tracking-[-0.01em] sm:text-[40px]">
            {t.rich('titleRich', { i: (c) => <span className="italic text-brand">{c}</span> })}
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1">
          {data && (
            <span className="rounded-full bg-muted px-3 py-2 font-mono text-[11px]">
              {t('version', {
                version: data.release.version,
                build: data.release.buildNumber ?? t('buildNone'),
              })}
            </span>
          )}
          <Link
            href="/admin/settings"
            className="rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium transition hover:bg-muted"
          >
            {t('allSettings')}
          </Link>
        </div>
      </header>

      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {data && (
        <>
          {data.release.demoMode && <Alert tone="warning">{t('release.demo')}</Alert>}

          <LicenceCard data={data} />
          <ProcessCard />

          <Section
            kicker={t('release.kicker')}
            title={t('release.title')}
            actions={
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={() => void q.refetch()}
                disabled={q.isFetching}
              >
                {t('refresh')}
              </Button>
            }
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('release.version')}</dt>
                <dd className="font-mono">{data.release.version}</dd>
                <dt className="text-muted-foreground">{t('release.gitSha')}</dt>
                <dd className="font-mono">{data.release.gitSha ?? t('release.none')}</dd>
                <dt className="text-muted-foreground">{t('release.buildNumber')}</dt>
                <dd className="font-mono">{data.release.buildNumber ?? t('release.none')}</dd>
                <dt className="text-muted-foreground">{t('release.builtAt')}</dt>
                <dd>{stamp(data.release.builtAt)}</dd>
                <dt className="text-muted-foreground">{t('release.environment')}</dt>
                <dd>{data.release.environment}</dd>
                <dt className="text-muted-foreground">{t('release.uptime')}</dt>
                <dd>{formatUptime(data.uptimeSeconds)}</dd>
              </dl>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('setup.title')}</p>
                <Badge tone={data.setup.state === 'completed' ? 'success' : 'warning'}>
                  {t(`setup.${data.setup.state}`)}
                </Badge>
                {data.setup.completedAt && (
                  <p className="text-sm text-muted-foreground">
                    {t('setup.completedAt', {
                      date: stamp(data.setup.completedAt),
                      version: data.setup.completedVersion ?? t('release.none'),
                    })}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section kicker={t('checks.kicker')} title={t('checks.title')}>
            <ul className="grid gap-2 sm:grid-cols-3">
              {data.checks.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-2 rounded-2xl border border-border p-3 text-sm"
                >
                  <span>{t(`checks.${c.key}`)}</span>
                  <span className="flex items-center gap-2">
                    {c.latencyMs !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {t('checks.latency', { ms: c.latencyMs })}
                      </span>
                    )}
                    <Badge tone={checkTone(c.status)}>{t(`checks.${c.status}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            kicker={t('migrations.kicker')}
            title={t('migrations.title')}
            actions={
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t('migrations.summary', { count: data.migrations.appliedCount })}
                </span>
                <Badge tone={migrationStatusTone(data.migrations.status)}>
                  {t(`migrations.status.${data.migrations.status}`)}
                </Badge>
              </span>
            }
          >
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pe-3 text-start font-medium">{t('migrations.id')}</th>
                    <th className="py-1 pe-3 text-start font-medium">
                      {t('migrations.stateLabel')}
                    </th>
                    <th className="py-1 text-start font-medium">{t('migrations.appliedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.migrations.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1 pe-3 font-mono text-xs">{r.id}</td>
                      <td className="py-1 pe-3">
                        <Badge tone={rowTone(r.state)}>{t(`migrations.state.${r.state}`)}</Badge>
                      </td>
                      <td className="py-1">{r.appliedAt ? stamp(r.appliedAt) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
