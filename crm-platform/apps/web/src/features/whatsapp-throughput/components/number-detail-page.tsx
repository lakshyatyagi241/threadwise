'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WABA_HIGH_MPS, type WabaNumberThroughput } from '@crm/contracts';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, StatTile, Switch } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { WAT_POLL_MS, fetchNumber, refreshNumber, saveControl, watKeys } from '../api';
import { isConflict } from '../lib/errors';
import { sourceTone, tierTone } from '../lib/format';
import { Sparkline } from './sparkline';
import { Failure, LoadingBlock, Meter } from './ui';

const NS = 'whatsapp-throughput';
const BACK = '/admin/whatsapp-throughput';

/** One number: its pace over the last minute and hour, the operator's override and pause, and what happened to it recently. */
export function NumberDetailPage({ id }: { id: string }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: watKeys.one(id),
    queryFn: ({ signal }) => fetchNumber(id, signal),
    refetchInterval: WAT_POLL_MS / 1.5,
    placeholderData: (prev) => prev,
  });
  const refresh = useMutation({
    mutationFn: () => refreshNumber(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: watKeys.one(id) }),
  });

  const back = (
    <Link
      href={BACK}
      className="text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
    >
      {t('detail.back')}
    </Link>
  );
  if (q.isPending) return <LoadingBlock />;
  if (q.isError && !q.data) {
    return (
      <div className="space-y-4">
        {back}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data!;
  const n = d.number;
  const time = (iso: string) => f.dateTime(new Date(iso), { timeStyle: 'medium' });

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow={n.workspace}
        title={n.displayPhoneNumber ?? n.label ?? n.phoneNumberId}
        description={t('detail.description', { id: n.phoneNumberId })}
        actions={
          <Button variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? t('detail.refreshing') : t('detail.refresh')}
          </Button>
        }
      />

      {refresh.isError && <Failure error={refresh.error} />}
      {!d.liveAvailable && <Alert tone="warning">{t('liveUnavailable')}</Alert>}
      {n.syncError && (
        <Alert tone="warning">{t('detail.syncError', { message: n.syncError })}</Alert>
      )}
      {n.coexistence && <Alert tone="info">{t('detail.coexistence')}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('detail.rate')}
          value={n.effectiveMps}
          hint={<Badge tone={sourceTone(n.source)}>{t(`source.${n.source}`)}</Badge>}
          tone="accent"
        />
        <StatTile
          label={t('kpi.now')}
          value={n.live.mpsNow}
          hint={t('peak', { n: n.live.peak1m })}
        />
        <StatTile
          label={t('detail.speed')}
          value={`${Math.round(n.live.speedFactor * 100)}%`}
          hint={n.live.speedFactor < 1 ? t('detail.speedSlowed') : t('detail.speedFull')}
          tone={n.live.speedFactor < 1 ? 'warning' : 'default'}
        />
        <StatTile
          label={t('detail.wait')}
          value={`${n.live.avgWaitMs5m} ms`}
          hint={t('detail.waitHint', { n: n.live.waited5m })}
        />
        <StatTile
          label={t('detail.meta')}
          value={n.metaLevel ?? t('detail.unknown')}
          hint={n.metaMps ? t('detail.metaHint', { n: n.metaMps }) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">{t('detail.chartSeconds')}</h2>
          <Sparkline
            points={d.perSecond}
            ceiling={n.effectiveMps}
            label={t('detail.chartSeconds')}
          />
          <p className="text-xs text-muted-foreground">{t('detail.chartLegend')}</p>
        </Card>
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">{t('detail.chartMinutes')}</h2>
          <Sparkline points={d.perMinute} label={t('detail.chartMinutes')} />
          <p className="text-xs text-muted-foreground">{t('detail.chartLegendMinutes')}</p>
        </Card>
      </div>

      <TierCard n={n} />

      <ControlCard key={n.rowVersion} id={id} n={n} />

      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('detail.events')}</h2>
        {d.events.length === 0 ? (
          <EmptyState title={t('detail.eventsEmpty')} message={t('detail.eventsEmptyBody')} />
        ) : (
          <ol className="divide-y divide-border">
            {d.events.map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
              >
                <time className="font-mono text-xs text-muted-foreground" dateTime={e.at}>
                  {time(e.at)}
                </time>
                <span className="font-medium">{t(`events.${e.kind}`)}</span>
                {e.detail && <span className="text-muted-foreground">{e.detail}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function TierCard({ n }: { n: WabaNumberThroughput }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const noCap = n.tier.state === 'unlimited' || n.tier.state === 'unknown';
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('detail.tierTitle')}</h2>
        <Badge tone={tierTone(n.tier.state)}>{n.tier.name ?? t('tier.unknown')}</Badge>
      </div>
      {noCap ? (
        <p className="text-sm text-muted-foreground">{t(`tier.${n.tier.state}Body`)}</p>
      ) : (
        <>
          <Meter
            value={n.tier.used24h}
            max={n.tier.cap ?? 1}
            tone={tierTone(n.tier.state)}
            label={t('detail.tierTitle')}
          />
          <p className="text-sm tabular-nums">
            {t('tierUsed', { used: f.number(n.tier.used24h), cap: f.number(n.tier.cap ?? 0) })}
            {n.tier.pct !== null && <span className="text-muted-foreground"> ({n.tier.pct}%)</span>}
          </p>
        </>
      )}
      <p className="max-w-3xl text-xs text-muted-foreground">{t('detail.tierNote')}</p>
    </Card>
  );
}

/** The override and the pause. `key` is the row version: after a save or a conflict reload the form starts from what is stored. */
function ControlCard({ id, n }: { id: string; n: WabaNumberThroughput }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const [override, setOverride] = useState<string>(
    n.control.overrideMps ? String(n.control.overrideMps) : '',
  );
  const [paused, setPaused] = useState(n.control.paused);
  const [reason, setReason] = useState(n.control.pauseReason ?? '');
  const [saved, setSaved] = useState(false);

  const parsed = override.trim() === '' ? null : Number.parseInt(override, 10);
  const overrideValid =
    parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= WABA_HIGH_MPS);

  const save = useMutation({
    mutationFn: () =>
      saveControl(id, {
        overrideMps: parsed,
        paused,
        pauseReason: paused ? reason.trim() || null : null,
        rowVersion: n.rowVersion,
      }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: watKeys.one(id) });
      void qc.invalidateQueries({ queryKey: watKeys.overviewAll });
    },
    onError: (err) => {
      if (isConflict(err)) void qc.invalidateQueries({ queryKey: watKeys.one(id) });
    },
  });

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t('control.title')}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('control.description')}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (overrideValid) save.mutate();
        }}
      >
        <div className="max-w-xs">
          <Field
            label={t('control.override')}
            hint={t('control.overrideHelp', { max: WABA_HIGH_MPS })}
            error={overrideValid ? undefined : t('control.overrideInvalid', { max: WABA_HIGH_MPS })}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={WABA_HIGH_MPS}
              placeholder={t('control.overridePlaceholder')}
              value={override}
              onChange={(e) => {
                setSaved(false);
                setOverride(e.target.value);
              }}
            />
          </Field>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={paused}
            onCheckedChange={(v) => {
              setSaved(false);
              setPaused(v);
            }}
            label={t('control.pause')}
          />
          <div>
            <p className="text-sm font-medium">{t('control.pause')}</p>
            <p className="text-xs text-muted-foreground">{t('control.pauseHelp')}</p>
          </div>
        </div>
        {paused && (
          <div className="max-w-xl">
            <Field label={t('control.reason')} hint={t('control.reasonHelp')}>
              <Input
                maxLength={200}
                value={reason}
                onChange={(e) => {
                  setSaved(false);
                  setReason(e.target.value);
                }}
              />
            </Field>
          </div>
        )}

        {save.isError && <Failure error={save.error} />}
        {saved && <Alert tone="success">{t('control.saved')}</Alert>}

        <Button type="submit" disabled={save.isPending || !overrideValid}>
          {save.isPending ? t('settings.saving') : t('settings.save')}
        </Button>
      </form>
    </Card>
  );
}
