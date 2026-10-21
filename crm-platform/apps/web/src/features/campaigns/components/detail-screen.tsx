'use client';

import { SenderBreakdown } from './sender-breakdown';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { costLabel } from '../wizard/lib/money';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Spinner,
  StatTile,
  Tabs,
  useToast,
} from '@crm/ui';
import type { CampaignDetail } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  cancelCampaign,
  deleteCampaign,
  download,
  resendCampaign,
  resumeCampaign,
  sendNowCampaign,
  useCampaignDetail,
  useCampaignLive,
} from '../api/campaigns';
import { freshest, isInFlight, waiting } from '../lib/live-model';
import { can } from '../lib/list-model';
import { defaultTab } from '../lib/summary-model';
import { AreaChart, Donut, HBars, HourHeatmap } from './charts';
import {
  ChevronLeftIcon,
  DownloadIcon,
  EditIcon,
  PlayIcon,
  ResendIcon,
  StopIcon,
  TrashIcon,
} from './icons';
import { DirectorSummary } from './director-summary';
import { EngagementTab } from './engagement-tab';
import { RecipientsTab } from './recipients-tab';
import { StatisticsTab } from './statistics-tab';

const TONE: Record<string, string> = {
  running: 'border-success/30 bg-success/10 text-success',
  paused: 'border-[#D9C7E8] bg-[#EFE5F5] text-[#5B3D8A]',
  scheduled: 'border-[#13478A]/30 bg-[#13478A]/10 text-[#13478A]',
  completed: 'border-foreground bg-foreground text-background',
  failed: 'border-danger/30 bg-danger/10 text-danger',
  cancelled: 'border-border bg-muted text-muted-foreground',
  draft: 'border-border bg-muted/50 text-foreground',
};
const OUTCOME_COLOR: Record<string, string> = {
  queued: 'var(--muted-foreground)',
  pending: 'var(--muted-foreground)',
  sent: 'var(--brand)',
  delivered: 'var(--success)',
  read: 'var(--primary)',
  responded: 'var(--warning)',
  failed: 'var(--danger)',
  unsubscribed: '#5B3D8A',
  skipped: 'var(--border)',
};
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString();

type Pending = 'delete' | 'resendAll' | null;

/**
 * `/campaigns/:id` (TW-CAMP-016 to 020): the campaign's numbers, funnel and charts, its message and audience, and the tabs of
 * recipients, replies, failures and opt-outs, with the actions its status allows. It follows the worker every 15 seconds.
 */
export function DetailScreen({ id }: { id: string }) {
  const t = useTranslations('campaigns.detail');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canControl = useCan('camp.campaigns.control');
  const canUpdate = useCan('camp.campaigns.update');
  const canDelete = useCan('camp.campaigns.delete');
  const canExport = useCan('camp.campaigns.export');
  const session = useSession();
  const res = useCampaignDetail(id);
  // Live stats: the light read follows a campaign that is scheduled or running (every 12 s, visible tab only) and stops by itself once
  // the server says it is at rest. When it does, the heavy detail is read once more for the final figures.
  const flying = isInFlight(res.data?.campaign.status);
  const live = useCampaignLive(id, flying);
  const liveDone = live.data !== undefined && !live.data.inFlight;
  useEffect(() => {
    if (flying && liveDone) void qc.invalidateQueries({ queryKey: KEYS.detail(id), exact: true });
  }, [flying, liveDone, qc, id]);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  if (res.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (res.isError || !res.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          title={t('notFound')}
          actions={
            <Link
              href="/campaigns"
              className="inline-flex h-10 items-center rounded-full border border-border px-4 text-xs font-semibold"
            >
              {t('back')}
            </Link>
          }
        />
      </main>
    );
  }
  const d: CampaignDetail = res.data;
  const c = d.campaign;
  // the zone the recipient times and the CSV export use: the campaign's own, else the workspace's (a migrated campaign may have none)
  const zone = c.timezone ?? session.org.timezone ?? 'UTC';
  const f = freshest(d, res.dataUpdatedAt, live.data, live.dataUpdatedAt);
  const n = f.counts;
  const shownStatus = f.status as typeof c.status;

  const act = async (action: () => Promise<unknown>, ok: string, then?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast(ok, 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
      then?.();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const exportRows = async () => {
    try {
      const { blob, filename } = await download(`/campaigns/${id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(message(e, t('exportFailed')), 'danger');
    }
  };
  // A finished campaign opens on the Summary; a live one on the Overview. The address can name any tab, and its other parameters
  // (the summary's `window`) are kept when the tab changes.
  const fallbackTab = defaultTab(c.status);
  const tab = search.get('tab') ?? fallbackTab;
  const setTab = (next: string) => {
    const p = new URLSearchParams(search.toString());
    if (next === fallbackTab) p.delete('tab');
    else p.set('tab', next);
    const q = p.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  };

  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-xs font-medium hover:bg-muted disabled:opacity-50';
  const rate = (v: number) => `${v.toFixed(1)}%`;
  // What is still waiting to go out, and what a run holds right now (the live read brings both).
  const waitingHint =
    waiting(f)
      .map(([kind, count]) => t(`live.${kind}`, { count }))
      .join(' · ') || undefined;

  const overview = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('overview.funnel')}</h3>
          <HBars
            rows={d.funnel.map((f) => ({
              label: t(`overview.funnelKeys.${f.key}`),
              value: f.count,
            }))}
            color="var(--brand)"
            label={t('overview.funnel')}
          />
        </div>
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('overview.outcomes')}</h3>
          <Donut
            slices={d.outcomes.map((o) => ({
              label: t(`recipients.statuses.${o.status}`),
              value: o.count,
              color: OUTCOME_COLOR[o.status] ?? 'var(--border)',
            }))}
            centre={String(n.recipients)}
            caption={t('overview.recipients')}
            label={t('overview.outcomes')}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
        <h3 className="mb-3 text-lg">{t('overview.timeline')}</h3>
        {d.daily.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t('overview.noActivity')}
          </p>
        ) : (
          <AreaChart
            labels={d.daily.map((x) => x.date.slice(5))}
            label={t('overview.timeline')}
            series={[
              {
                name: t('overview.funnelKeys.sent'),
                color: 'var(--brand)',
                data: d.daily.map((x) => x.sent),
              },
              {
                name: t('overview.funnelKeys.delivered'),
                color: 'var(--success)',
                data: d.daily.map((x) => x.delivered),
              },
              {
                name: t('overview.funnelKeys.read'),
                color: 'var(--primary)',
                data: d.daily.map((x) => x.read),
              },
              {
                name: t('overview.funnelKeys.replies'),
                color: 'var(--warning)',
                data: d.daily.map((x) => x.replies),
              },
            ]}
          />
        )}
      </div>

      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
        <h3 className="mb-3 text-lg">{t('overview.hours')}</h3>
        <HourHeatmap
          hours={d.hourly}
          label={t('overview.hours')}
          empty={t('overview.noActivity')}
        />
      </div>

      {d.variants.length > 1 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('overview.variants')}</h3>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-start text-muted-foreground">
                {(
                  [
                    'variant',
                    'recipients',
                    'sent',
                    'delivered',
                    'read',
                    'replies',
                    'clicks',
                  ] as const
                ).map((k) => (
                  <th
                    key={k}
                    className="px-3 py-2 text-start font-mono text-[10px] uppercase tracking-wide"
                  >
                    {t(`overview.variantCols.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.variants.map((v) => (
                <tr key={v.variant} className="border-t border-border/60">
                  <td className="px-3 py-2 font-semibold">{v.variant}</td>
                  <td className="px-3 py-2 tabular-nums">{v.recipients}</td>
                  <td className="px-3 py-2 tabular-nums">{v.sent}</td>
                  <td className="px-3 py-2 tabular-nums">{v.delivered}</td>
                  <td className="px-3 py-2 tabular-nums">{v.read}</td>
                  <td className="px-3 py-2 tabular-nums">{v.replies}</td>
                  <td className="px-3 py-2 tabular-nums">{v.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SenderBreakdown lines={d.senders} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('overview.message')}</h3>
          <div className="rounded-xl p-4" style={{ background: '#e5ddd5' }}>
            <div
              className="max-w-[320px] rounded-2xl rounded-ss-md px-3.5 py-2.5 text-[13px] shadow-sm"
              style={{ background: '#fff', color: '#111' }}
            >
              {d.preview.templateName && (
                <div className="mb-1 font-semibold">{d.preview.templateName}</div>
              )}
              {d.preview.header && <div className="mb-1 font-semibold">{d.preview.header}</div>}
              {d.preview.mediaUrl && (
                <div className="mb-1 break-all font-mono text-[11px] opacity-70">
                  📎 {d.preview.mediaUrl.split('/').pop()}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words leading-snug">
                {d.preview.body || '—'}
              </div>
              {d.preview.footer && (
                <div className="mt-1 text-[11px] opacity-60">{d.preview.footer}</div>
              )}
              {d.preview.buttons.map((b, i) => {
                const label = String(
                  (b as Record<string, unknown>).text ?? (b as Record<string, unknown>).title ?? '',
                );
                return label ? (
                  <div
                    key={i}
                    className="mt-1.5 rounded-lg border border-black/10 px-2.5 py-1 text-center text-[12px]"
                    style={{ color: '#027eb5' }}
                  >
                    {label}
                  </div>
                ) : null;
              })}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('overview.audience')}</h3>
          <dl className="space-y-2 text-sm">
            {(
              [
                ['label', d.audience.label],
                ['uploaded', d.audience.uploaded.toLocaleString()],
                ['manual', d.audience.manual.toLocaleString()],
                ['invalid', d.audience.invalid.toLocaleString()],
                ['optOut', d.audience.optOutSkipped.toLocaleString()],
                ['finalList', d.audience.finalList.toLocaleString()],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(`overview.audienceKeys.${k}`)}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-border pt-2">
              <dt className="text-muted-foreground">{t('overview.sender')}</dt>
              <dd className="font-medium">{d.senderLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('overview.schedule')}</dt>
              <dd className="font-medium">
                {c.scheduleType === 'now'
                  ? t('overview.instant')
                  : `${c.sendDate ?? ''} ${c.sendTime ?? ''} ${c.timezone ?? ''}`.trim()}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );

  const failures = (
    <div className="space-y-5">
      {d.deliveryIssueReason && (
        <Alert tone="danger">
          <div className="font-semibold">{t('failures.reason')}</div>
          <div className="mt-0.5 break-words text-xs">{d.deliveryIssueReason}</div>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">{t('failures.count', { count: d.failedCount })}</div>
        {canControl && can.resend(c.status) && (
          <Button
            variant="secondary"
            className="rounded-full"
            disabled={busy || d.failedCount === 0}
            onClick={() =>
              void act(
                async () => {
                  await resendCampaign(id, { scope: 'failed', contactIds: [] });
                },
                t('failures.resending', { count: d.failedCount }),
              )
            }
          >
            <ResendIcon className="size-3.5" />
            {d.failedCount === 0
              ? t('failures.none')
              : t('failures.resend', { count: d.failedCount })}
          </Button>
        )}
      </div>
      {d.failureSummary.length > 0 && (
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('failures.summary')}</h3>
          <HBars
            rows={d.failureSummary.map((f) => ({ label: f.error, value: f.count }))}
            color="var(--danger)"
            label={t('failures.summary')}
          />
        </div>
      )}
      {d.failures.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-background shadow-sm">
          {d.failures.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
              <span className="min-w-0 break-words text-danger">{f.error}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{when(f.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const replies = (
    <div>
      {d.replies.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('replies.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-background shadow-sm">
          {d.replies.map((r, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold">{r.name || r.phone}</span>
                <span className="font-mono text-muted-foreground">{when(r.at)}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-[13px]">
                {r.response || '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.phone}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/campaigns"
            aria-label={t('back')}
            title={t('back')}
            className="mt-1 grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted"
          >
            <ChevronLeftIcon className="size-4" />
          </Link>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {t('kicker')} · {t(`type.${c.type}`)}
              {c.abTesting ? ' · A/B' : ''}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] leading-none sm:text-[34px]">{c.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] ${TONE[shownStatus]}`}
              >
                {t(`status.${shownStatus}`)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {t('created', { when: when(c.createdAt) })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canControl && can.cancel(c.status) && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void act(() => cancelCampaign(id), t('actions.cancelled'))}
            >
              <StopIcon className="size-3.5" />
              {t('actions.cancel')}
            </button>
          )}
          {canControl && can.resume(c.status) && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void act(() => resumeCampaign(id), t('actions.resumed'))}
            >
              <PlayIcon className="size-3" />
              {t('actions.resume')}
            </button>
          )}
          {canControl &&
            (c.status === 'scheduled' || c.status === 'draft' || c.status === 'paused') && (
              <button
                type="button"
                className={btn}
                disabled={busy}
                onClick={() => void act(() => sendNowCampaign(id), t('actions.sending'))}
              >
                <PlayIcon className="size-3" />
                {t('actions.sendNow')}
              </button>
            )}
          {c.wizard && c.status !== 'draft' && (
            <Link href={`/campaigns/wizard/broadcasts/${c.seriesId ?? c.id}`} className={btn}>
              {t('actions.broadcastStatus')}
            </Link>
          )}
          {canUpdate && can.edit(c.status) && (
            <Link href={`/campaigns/${id}/edit`} className={btn}>
              <EditIcon className="size-3.5" />
              {t('actions.edit')}
            </Link>
          )}
          {canControl && can.resend(c.status) && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => setPending('resendAll')}
            >
              <ResendIcon className="size-3.5" />
              {t('actions.resendAll')}
            </button>
          )}
          {canExport && (
            <button type="button" className={btn} onClick={() => void exportRows()}>
              <DownloadIcon className="size-3.5" />
              {t('actions.export')}
            </button>
          )}
          {canDelete && can.delete(c.status) && (
            <button
              type="button"
              className={`${btn} text-danger hover:bg-danger/10`}
              disabled={busy}
              onClick={() => setPending('delete')}
            >
              <TrashIcon className="size-3.5" />
              {t('actions.delete')}
            </button>
          )}
        </div>
      </div>

      {flying && (
        <p
          role="status"
          className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          {t('live.badge')}
          {f.fetchedAt &&
            ` · ${t('live.updated', { time: new Date(f.fetchedAt).toLocaleTimeString() })}`}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile
          label={t('kpi.recipients')}
          value={n.recipients.toLocaleString()}
          hint={waitingHint}
        />
        <StatTile label={t('kpi.sent')} value={n.sent.toLocaleString()} tone="accent" />
        <StatTile
          label={t('kpi.delivered')}
          value={n.delivered.toLocaleString()}
          hint={rate(f.rates.delivered)}
          tone="accent"
        />
        <StatTile label={t('kpi.read')} value={n.read.toLocaleString()} hint={rate(f.rates.read)} />
        <StatTile
          label={t('kpi.replies')}
          value={n.replies.toLocaleString()}
          hint={rate(f.rates.replies)}
        />
        <StatTile
          label={t('kpi.clicks')}
          value={n.clicks.toLocaleString()}
          hint={rate(f.rates.clicks)}
        />
        <StatTile
          label={t('kpi.failed')}
          value={n.failed.toLocaleString()}
          hint={rate(f.rates.failed)}
          tone={n.failed > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label={t('kpi.cost')}
          value={costLabel(d.campaign.cost, locale)}
          hint={t('kpi.costHint')}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          {
            id: 'summary',
            label: t('tabs.summary'),
            content: <DirectorSummary kind="campaign" id={id} />,
          },
          { id: 'overview', label: t('tabs.overview'), content: overview },
          { id: 'statistics', label: t('tabs.statistics'), content: <StatisticsTab id={id} /> },
          { id: 'messages', label: t('tabs.messages'), content: <RecipientsTab id={id} timezone={zone} /> },
          { id: 'engagement', label: t('tabs.engagement'), content: <EngagementTab d={d} /> },
          { id: 'replies', label: t('tabs.replies', { count: n.replies }), content: replies },
          {
            id: 'failures',
            label: t('tabs.failures', { count: d.failedCount }),
            content: failures,
          },
          {
            id: 'optouts',
            label: t('tabs.optouts', { count: d.optOutCount }),
            content: <RecipientsTab id={id} fixedStatus="unsubscribed" timezone={zone} />,
          },
        ]}
      />

      <ConfirmDialog
        open={pending !== null}
        tone="danger"
        busy={busy}
        title={pending === 'delete' ? t('delete.title') : t('resendAll.title')}
        message={pending === 'delete' ? t('delete.message') : t('resendAll.message')}
        confirmLabel={pending === 'delete' ? t('actions.delete') : t('actions.resendAll')}
        cancelLabel={t('cancel')}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p === 'delete')
            void act(
              () => deleteCampaign(id),
              t('deleted'),
              () => router.push('/campaigns'),
            );
          else
            void act(async () => {
              await resendCampaign(id, { scope: 'all', contactIds: [] });
            }, t('resentAll'));
        }}
      />
    </main>
  );
}
