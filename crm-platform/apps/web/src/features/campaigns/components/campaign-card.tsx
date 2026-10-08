'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { Campaign, CampaignStatus } from '@crm/contracts';
import { can, deliveryRate } from '../lib/list-model';
import {
  CalendarIcon,
  CheckIcon,
  ChartIcon,
  ClockIcon,
  DownloadIcon,
  DraftIcon,
  EditIcon,
  PauseIcon,
  PlayIcon,
  ResendIcon,
  StopIcon,
  TrashIcon,
  UsersIcon,
  WarnIcon,
} from './icons';

/** The pill and the round status icon of each status, in Reference's colours. */
const LOOK: Record<CampaignStatus, { pill: string; dot: string; icon: string; border: string }> = {
  running: {
    pill: 'border-success/30 bg-success/10 text-success',
    dot: 'bg-success',
    icon: 'bg-success/10 text-success',
    border: 'border-border hover:border-success/40',
  },
  paused: {
    pill: 'border-[#D9C7E8] bg-[#EFE5F5] text-[#5B3D8A]',
    dot: 'bg-[#5B3D8A]',
    icon: 'bg-[#EFE5F5] text-[#5B3D8A]',
    border: 'border-border hover:border-success/40',
  },
  scheduled: {
    pill: 'border-[#13478A]/30 bg-[#13478A]/10 text-[#13478A]',
    dot: 'bg-[#13478A]',
    icon: 'bg-[#13478A]/10 text-[#13478A]',
    border: 'border-border hover:border-success/40',
  },
  completed: {
    pill: 'border-foreground bg-foreground text-background',
    dot: 'bg-background',
    icon: 'bg-success/10 text-success',
    border: 'border-border hover:border-success/40',
  },
  failed: {
    pill: 'border-danger/30 bg-danger/10 text-danger',
    dot: 'bg-danger',
    icon: 'bg-danger/10 text-danger',
    border: 'border-danger/30 hover:border-danger',
  },
  cancelled: {
    pill: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/50',
    icon: 'bg-muted text-muted-foreground',
    border: 'border-border hover:border-success/40',
  },
  draft: {
    pill: 'border-border bg-muted/50 text-foreground',
    dot: 'bg-muted-foreground/50',
    icon: 'bg-muted text-muted-foreground',
    border: 'border-border hover:border-success/40',
  },
};

const STATUS_ICON: Record<CampaignStatus, typeof PlayIcon> = {
  running: PlayIcon,
  paused: PauseIcon,
  scheduled: ClockIcon,
  completed: CheckIcon,
  failed: WarnIcon,
  cancelled: StopIcon,
  draft: DraftIcon,
};

const ROUND =
  'grid size-8 place-items-center rounded-full border border-border bg-background text-success hover:bg-muted disabled:opacity-50';

/** One campaign on the list (TW-CAMP-001): status icon and pill, the actions its status allows, seven numbers and a footer. */
export function CampaignCard({
  c,
  selected,
  busy,
  canControl,
  canUpdate,
  canDelete,
  canExport,
  onSelect,
  onCancel,
  onResume,
  onResend,
  onDelete,
  onExport,
}: {
  c: Campaign;
  selected: boolean;
  busy: boolean;
  canControl: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  onSelect: (on: boolean) => void;
  onCancel: () => void;
  onResume: () => void;
  onResend: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const t = useTranslations('campaigns.list.card');
  const look = LOOK[c.status];
  const Icon = STATUS_ICON[c.status];
  const n = c.counts;
  /** A draft made by the "Create broadcast" wizard resumes there, not in the classic builder (which cannot show it). */
  const wizardDraft = c.wizard && c.status === 'draft';
  const editHref = wizardDraft ? `/campaigns/wizard/${c.id}` : `/campaigns/${c.id}/edit`;
  const titleHref = wizardDraft ? editHref : `/campaigns/${c.id}`;
  /** A launched wizard broadcast is not edited in the classic builder either. */
  const editable = c.wizard ? wizardDraft : can.edit(c.status);
  const metric = (label: string, value: number, tone?: string) => (
    <div className="rounded-[10px] border border-border bg-background px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-0.5 text-sm font-semibold tabular-nums', tone)}>
        {value.toLocaleString()}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'rounded-2xl border bg-background px-5 py-[18px] transition hover:shadow-md',
        look.border,
      )}
      data-campaign-id={c.id}
    >
      <div className="mb-3 flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={t('select', { name: c.name })}
          className="mt-1.5 size-6 shrink-0 accent-[var(--primary)]"
        />
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', look.icon)}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={titleHref}
              className="min-h-6 min-w-6 truncate text-[15px] font-semibold leading-6 hover:underline"
            >
              {c.name}
            </Link>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(`type.${c.type}`)}
            </span>
            {c.abTesting && (
              <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand">
                A/B
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]',
              look.pill,
            )}
          >
            <span className={cn('size-1.5 rounded-full', look.dot)} />
            {t(`status.${c.status}`)}
          </span>
          {canControl && can.cancel(c.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-background px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              <StopIcon className="size-3.5" />
              {t('cancel')}
            </button>
          )}
          {canControl && can.resume(c.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={onResume}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              <PlayIcon className="size-3" />
              {t('resume')}
            </button>
          )}
          <Link
            href={`/campaigns/${c.id}`}
            className={ROUND}
            title={t('analytics')}
            aria-label={t('analytics')}
          >
            <ChartIcon className="size-3.5" />
          </Link>
          {canExport && (
            <button
              type="button"
              className={ROUND}
              title={t('export')}
              aria-label={t('export')}
              onClick={onExport}
            >
              <DownloadIcon className="size-3.5" />
            </button>
          )}
          {canUpdate && editable && (
            <Link
              href={editHref}
              className={cn(ROUND, 'text-foreground')}
              title={t('edit')}
              aria-label={t('edit')}
            >
              <EditIcon className="size-3.5" />
            </Link>
          )}
          {canControl && can.resend(c.status) && (
            <button
              type="button"
              disabled={busy}
              className={ROUND}
              title={t('resend')}
              aria-label={t('resend')}
              onClick={onResend}
            >
              <ResendIcon className="size-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              disabled={busy}
              className={cn(
                ROUND,
                'text-muted-foreground hover:border-danger hover:bg-danger/10 hover:text-danger',
              )}
              title={t('delete')}
              aria-label={t('delete')}
              onClick={onDelete}
            >
              <TrashIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {c.status === 'failed' && n.failed > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3">
          <WarnIcon className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <div className="text-[12.5px] font-semibold text-danger">
              {t('failedBanner', { count: n.failed })}
            </div>
            <div className="mt-0.5 text-[11px]">{t('failedBannerHint')}</div>
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {metric(t('sent'), n.sent)}
        {metric(t('delivered'), n.delivered)}
        {metric(t('read'), n.read)}
        {metric(t('replied'), n.replies)}
        {metric(t('clicked'), n.clicks)}
        {metric(t('failed'), n.failed, n.failed > 0 ? 'text-danger' : undefined)}
        <div className="rounded-[10px] border border-success/20 bg-success/10 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-success">
            {t('delivery')}
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-success">
            {deliveryRate(n).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[18px] border-t border-border pt-3 font-mono text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" />
          {t('created', { date: c.createdAt.slice(0, 10) })}
        </span>
        <span className="flex items-center gap-1.5">
          <UsersIcon className="size-3.5" />
          {t('recipients', { count: n.recipients })}
        </span>
        {c.scheduleType === 'scheduled' && c.sendDate ? (
          <span className="flex items-center gap-1.5">
            <ClockIcon className="size-3.5" />
            {t('scheduled', { date: c.sendDate })}
            {c.sendTime ? ` · ${c.sendTime}` : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <PlayIcon className="size-3" />
            {t('instant')}
          </span>
        )}
        {c.templateName && <span>{t('template', { name: c.templateName })}</span>}
      </div>
    </div>
  );
}
