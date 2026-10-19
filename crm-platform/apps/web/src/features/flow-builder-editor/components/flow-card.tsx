'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FlowFeatured, type FlowState, type FlowSummary } from '@crm/contracts';
import { cn } from '@crm/ui';
import { purposeOf, relativeTime } from '../lib/list-model';
import { useFlb, useMsg } from '../lib/msg';
import { flowTypeLabel } from '../lib/contract-text';
import { openHref, type BuilderMode } from '../lib/builder-mode';

export const STATE_STYLE: Record<FlowState, { pill: string; dot: string }> = {
  live: { pill: 'bg-primary/10 text-brand border-primary/30', dot: 'bg-primary' },
  paused: { pill: 'bg-[#EFE5F5] text-[#5B3D8A] border-[#D9C7E8]', dot: 'bg-[#5B3D8A]' },
  draft: { pill: 'bg-muted text-muted-foreground border-border', dot: 'bg-border' },
};

const CATEGORY_STYLE: Record<string, { icon: string; bg: string; text: string }> = {
  welcome: {
    icon: 'M3 11s2-1 5-1 5 1 5 1M5 6.5h.01M11 6.5h.01M8 9.5s1 .8 0 1.5',
    bg: 'bg-[var(--flb-bubble)]',
    text: 'text-brand',
  },
  cart: { icon: 'M3 5h8l1 6H4z', bg: 'bg-[var(--flb-mint)]', text: 'text-brand' },
  'cart-recovery': { icon: 'M3 5h8l1 6H4z', bg: 'bg-[var(--flb-mint)]', text: 'text-brand' },
  'post-purchase': {
    icon: 'M8 1.5l1.6 4.2H14l-3.5 2.5 1.4 4.3L8 9.9l-3.9 2.6 1.4-4.3L2 5.7h4.4z',
    bg: 'bg-[#FCE0D5]',
    text: 'text-[#A1431F]',
  },
  're-engagement': {
    icon: 'M3 8a5 5 0 0 1 8.5-3.5L13 6M13 3v3h-3M13 8a5 5 0 0 1-8.5 3.5L3 10M3 13v-3h3',
    bg: 'bg-[#F3E9FF]',
    text: 'text-[#5B3D8A]',
  },
  lead: {
    icon: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14c0-3 2.7-5 6-5s6 2 6 5',
    bg: 'bg-[#D9E5F2]',
    text: 'text-[#13478A]',
  },
  'lead-nurture': {
    icon: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14c0-3 2.7-5 6-5s6 2 6 5',
    bg: 'bg-[#D9E5F2]',
    text: 'text-[#13478A]',
  },
  event: {
    icon: 'M3 4h10v9H3zM3 7h10M6 2v3M10 2v3',
    bg: 'bg-[var(--flb-bubble)]',
    text: 'text-brand',
  },
  'special-events': {
    icon: 'M3 4h10v9H3zM3 7h10M6 2v3M10 2v3',
    bg: 'bg-[var(--flb-bubble)]',
    text: 'text-brand',
  },
};
const NEUTRAL = { icon: 'M2 4h12v8H2zM2 7h12', bg: 'bg-muted', text: 'text-foreground/80' };
export const categoryStyle = (c: string | null) => CATEGORY_STYLE[c ?? ''] ?? NEUTRAL;

/** Reference's global `.pill`: mono 9.5px uppercase, 1px 7px padding, 1px border. */
export const PILL =
  'inline-flex items-center gap-1 rounded-full border px-[7px] py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em]';

const Check = () => (
  <svg
    viewBox="0 0 12 12"
    className="h-3 w-3 text-brand"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M2 6.5l3 2 5-6" />
  </svg>
);
const IconButton = ({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    className={cn(
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted',
      danger &&
        'hover:border-[var(--flb-coral)] hover:bg-[var(--flb-coral)]/10 hover:text-[var(--flb-coral)]',
    )}
  >
    {children}
  </button>
);
const Svg = ({
  d,
  className = 'h-3 w-3',
  fill,
}: {
  d: string;
  className?: string;
  fill?: boolean;
}) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill={fill ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export interface CardActions {
  onToggle: (f: FlowSummary) => void | Promise<void>;
  onRename: (f: FlowSummary) => void;
  onDuplicate: (f: FlowSummary | FlowFeatured) => void | Promise<void>;
  onExport: (f: FlowSummary) => void | Promise<void>;
  onDelete: (f: FlowSummary) => void;
  can: { update: boolean; create: boolean; remove: boolean; faqs?: boolean };
  /** Which builder(s) the platform admin offers; absent means both. */
  builderMode?: BuilderMode;
}

export function triggerLabelKey(
  kind: string,
): 'triggerTag' | 'triggerGroup' | 'triggerManual' | 'triggerKeyword' {
  if (kind === 'tag_added') return 'triggerTag';
  if (kind === 'group_join') return 'triggerGroup';
  if (kind === 'manual_enroll') return 'triggerManual';
  return 'triggerKeyword';
}

/** One flow in the grid: category icon, state pill, title, the static purpose line, three bullets and the action row. */
export function FlowCard({ flow, actions }: { flow: FlowSummary; actions: CardActions }) {
  const t = useTranslations('flb.card');
  const tf = useFlb();
  const m = useMsg();
  const tl = useTranslations('flb.list.state');
  const sty = STATE_STYLE[flow.state];
  const cat = categoryStyle(flow.category);
  const hasSubs =
    flow.subscribers.active + flow.subscribers.completed + flow.subscribers.failed > 0;
  return (
    <div
      data-flow-card={flow.id}
      className="flex flex-col rounded-[14px] border border-border bg-background p-[18px] transition hover:-translate-y-px hover:border-brand hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        {flow.flowType === 'instagram' ? (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C,#F77737)' }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </div>
        ) : flow.flowType === 'web' || flow.flowType === 'chat' ? (
          // A WhatsApp or website bot's flow wears the bot picture where the others have their category icon.
          <div
            data-testid="flow-card-bot"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50"
          >
            <Image
              src="/images/bot-3d.png"
              alt=""
              width={30}
              height={30}
              unoptimized
              className="size-[30px] object-contain"
            />
          </div>
        ) : (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              cat.bg,
              cat.text,
            )}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d={cat.icon} />
            </svg>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {flow.flowType === 'instagram' ? (
            <span
              className={PILL}
              style={{ background: '#FCE7F3', color: '#9D174D', borderColor: '#F9A8D4' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#E1306C' }} />
              {t('instagram')}
            </span>
          ) : flow.flowType === 'call' ? (
            <span className={cn(PILL, 'border-amber-300/50 bg-amber-100/60 text-[#7B5A14]')}>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {t('call')}
            </span>
          ) : null}
          <span className={cn(PILL, sty.pill)} data-state={flow.state}>
            <span className={cn('h-1.5 w-1.5 rounded-full', sty.dot)} />
            {tl(flow.state)}
          </span>
          {flow.flowType === 'chat' ? (
            <span
              title={flowTypeLabel(tf, 'chat')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white"
            >
              {/* The WhatsApp mark as one filled shape (a bubble with its handset cut out), so nothing overlaps. */}
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
              </svg>
            </span>
          ) : flow.flowType === 'web' ? (
            <span
              title={flowTypeLabel(tf, 'web')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <path d="M2 8a6 6 0 1 0 12 0A6 6 0 0 0 2 8Zm0 0h12M8 2c1.7 1.7 2.5 3.7 2.5 6S9.7 12.3 8 14C6.3 12.3 5.5 10.3 5.5 8S6.3 3.7 8 2Z" />
              </svg>
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-1 text-[14px] font-semibold">{flow.name || t('untitled')}</div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {m(purposeOf(flow.category))}
      </p>

      <ul className="mt-3 space-y-1 text-[12px] text-foreground/70">
        <li className="flex items-center gap-2">
          <Check />
          {t('nodes', { count: flow.nodeCount })} · {t('edges', { count: flow.edgeCount })}
        </li>
        <li className="flex items-center gap-2">
          <Check />
          {t(triggerLabelKey(flow.triggerKind))}
        </li>
        <li className="flex items-center gap-2">
          <Check />
          {hasSubs ? (
            <span>
              <span className="font-mono">{flow.subscribers.active}</span> {t('active')} ·{' '}
              <span className="font-mono">{flow.subscribers.completed}</span> {t('done')}
              {flow.subscribers.failed > 0 ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-mono text-[var(--flb-coral)]">
                    {flow.subscribers.failed}
                  </span>{' '}
                  {t('failed')}
                </>
              ) : null}
            </span>
          ) : (
            t('edited', { when: m(relativeTime(flow.updatedAt)) })
          )}
        </li>
      </ul>

      <div className="mt-4 flex items-center gap-2">
        {/* Every card offers the builder, a manual-enroll flow too (its "Enroll contacts" link comes beside it, not instead of it). */}
        <Link
          href={openHref(actions.builderMode ?? 'advanced', flow.id, flow.flowType)}
          className="min-w-0 flex-1 rounded-full border border-border px-2 py-1.5 text-center text-[11.5px] font-medium whitespace-nowrap hover:bg-muted"
        >
          {t('openBuilder')}
        </Link>
        {flow.triggerKind === 'manual_enroll' ? (
          <Link
            href={`/flow-runtime/flows/${flow.id}`}
            data-flow-enroll={flow.id}
            className="min-w-0 flex-1 rounded-full bg-brand px-2 py-1.5 text-center text-[11.5px] font-semibold text-brand-foreground hover:opacity-90"
          >
            {t('enroll')}
          </Link>
        ) : null}
        {actions.can.faqs && flow.flowType !== 'call' ? (
          // A flow's FAQs, its unanswered questions and the message sent when nothing matches are on the FAQs tab of its builder.
          <Link
            href={`${openHref(actions.builderMode ?? 'advanced', flow.id, flow.flowType)}?tab=faqs`}
            data-flow-faqs={flow.id}
            title={t('faqs')}
            aria-label={t('faqs')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted"
          >
            <Svg d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.2 6.3A1.9 1.9 0 0 1 8 5c1 0 1.9.7 1.9 1.7 0 1.3-1.9 1.4-1.9 2.6M8 11.2v.1" />
          </Link>
        ) : null}
        {flow.flowType !== 'instagram' ? (
          // Per-flow runs, errors and retries live in the runtime's analytics (FLR); an Instagram flow has no local runs.
          <Link
            href={`/flow-runtime/analytics?flowId=${flow.id}`}
            title={t('analytics')}
            aria-label={t('analytics')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted"
          >
            <Svg d="M2 13.5h12M4.5 13.5V9M8 13.5V3.5M11.5 13.5V6.5" />
          </Link>
        ) : null}
        {actions.can.update ? (
          <IconButton
            title={flow.isActive ? t('pause') : t('resume')}
            onClick={() => void actions.onToggle(flow)}
          >
            {flow.isActive ? (
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <rect x="3" y="2" width="2" height="8" rx="0.5" />
                <rect x="7" y="2" width="2" height="8" rx="0.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <polygon points="3,2 10,6 3,10" />
              </svg>
            )}
          </IconButton>
        ) : null}
        {actions.can.update ? (
          <IconButton title={t('rename')} onClick={() => actions.onRename(flow)}>
            <Svg d="M11 2.5l2.5 2.5L5 13.5H2.5V11zM9.5 4l2.5 2.5" />
          </IconButton>
        ) : null}
        {actions.can.create ? (
          <IconButton title={t('duplicate')} onClick={() => void actions.onDuplicate(flow)}>
            <Svg d="M3 3h8v9H3zM5 3V2h8v9h-1" />
          </IconButton>
        ) : null}
        <IconButton title={t('export')} onClick={() => void actions.onExport(flow)}>
          <Svg d="M8 9V2M5 5l3-3 3 3M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
        </IconButton>
        {actions.can.remove ? (
          <IconButton title={t('delete')} danger onClick={() => actions.onDelete(flow)}>
            <Svg d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

const NODE_VARIANT: Record<string, string> = {
  trigger: 'bg-[var(--flb-bubble)] border-solid border-primary text-brand font-medium',
  send: 'bg-[var(--flb-bubble)] border-solid border-primary/40 text-brand',
  wait: 'bg-[#FFF6E0] border-solid border-amber-400 text-[#7B5A14]',
  cond: 'bg-[#F4E9C9] border-solid border-[#D9B864] text-[#7B5A14]',
  tag: 'bg-[#E4DAF1] border-solid border-[#B59FE0] text-[#5B3D8A]',
  end: 'bg-[#FCE0D5] border-solid border-[var(--flb-coral)] text-[#A1431F] font-medium',
};
const NODE_KIND: Record<string, string> = {
  trigger: 'trigger',
  delay: 'wait',
  condition: 'cond',
  message: 'send',
  template: 'send',
  media: 'send',
  buttons: 'send',
  list: 'send',
  tag: 'tag',
  assign: 'tag',
  end: 'end',
};
/** The big card for the workspace's featured flow, with a mini preview of its first nodes. */
export function FeaturedCard({ flow, actions }: { flow: FlowFeatured; actions: CardActions }) {
  const t = useTranslations('flb.featured');
  const m = useMsg();
  const tl = useTranslations('flb.list.state');
  // `ucfirst(str_replace('-', ' ', category))`, "Flow" when there is none; the pill style upper-cases it.
  const raw = (flow.category || 'flow').replace(/-/g, ' ');
  const catLabel = raw.charAt(0).toUpperCase() + raw.slice(1);
  const sty = STATE_STYLE[flow.isPublished ? 'live' : 'draft'];
  const wait =
    flow.waitMinutes > 0
      ? `~${flow.waitMinutes >= 60 ? `${Math.round((flow.waitMinutes / 60) * 10) / 10} h` : `${flow.waitMinutes} min`} total`
      : 'no waits';
  return (
    <div
      className="mb-5 grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-background shadow-sm xl:grid-cols-[1.5fr_1fr]"
      data-testid="featured-flow"
    >
      <div className="p-6 md:p-7">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={cn(PILL, 'border-current bg-[var(--flb-bubble)] text-brand')}>
            {catLabel}
          </span>
          <span className={cn(PILL, 'border-primary/40 bg-[var(--flb-mint)] text-brand')}>
            <svg
              viewBox="0 0 12 12"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M2 6.5l3 2 5-6" />
            </svg>
            {t('mostUsed')}
          </span>
          <span
            className={cn(
              PILL,
              'border-current',
              flow.isPublished
                ? 'bg-[var(--flb-mint)] text-brand'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', sty.dot)} />
            {tl(flow.isPublished ? 'live' : 'draft')}
          </span>
        </div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('eyebrow')}
        </div>
        <h2 className="font-serif text-[26px] leading-[1.05] font-normal tracking-tight sm:text-[32px] lg:text-[36px]">
          {flow.name}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Svg d="M4 4v8M12 4v8M4 8h8" className="h-3.5 w-3.5" />
            {t('steps', { count: flow.steps })}
          </span>
          <span className="flex items-center gap-1.5">
            <Svg d="M2 3h12v9H2zM5 15h6" className="h-3.5 w-3.5" />
            {t('messages', { count: flow.messages })}
          </span>
          <span className="flex items-center gap-1.5">
            <Svg d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3l2 2" className="h-3.5 w-3.5" />
            {wait}
          </span>
          <span className="flex items-center gap-1.5">
            <Svg d="M3 8l3 3 7-7" className="h-3.5 w-3.5" />
            {t('connections', { count: flow.edgeCount })}
          </span>
        </div>
        <p className="mt-4 max-w-xl text-[14px] leading-[1.65] text-foreground/80">
          {t('updated', { when: m(relativeTime(flow.updatedAt)) })}
        </p>
        <div className="mt-6 flex items-center gap-2">
          <Link
            href={openHref(actions.builderMode ?? 'advanced', flow.id, flow.flowType)}
            className="rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
          >
            {t('open')}
          </Link>
          {actions.can.create ? (
            <button
              type="button"
              onClick={() => void actions.onDuplicate(flow)}
              className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground hover:opacity-90"
            >
              {t('duplicate')}
              <Svg d="M3 13l10-10M5 3h8v8" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="flex items-center justify-center border-t border-border p-5 xl:border-t-0 xl:border-l"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg,color-mix(in srgb, var(--brand) 6%, transparent) 0 6px,transparent 6px 12px)',
        }}
      >
        <div className="w-full max-w-xs">
          {flow.preview.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border bg-background px-3 py-6 text-center text-[11px] text-muted-foreground">
              {t('emptyPreview')}
            </div>
          ) : (
            <>
              {flow.preview.map((n, i) => (
                <div key={i}>
                  <div
                    className={cn(
                      'flex items-center gap-1.5 rounded-[10px] border border-dashed border-[#C9D7CE] bg-background px-2.5 py-2 text-[11px] text-foreground/80',
                      NODE_VARIANT[NODE_KIND[n.type] ?? ''],
                    )}
                  >
                    <svg
                      viewBox="0 0 12 12"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <circle cx="6" cy="6" r="3" />
                    </svg>
                    {n.label}
                  </div>
                  {i < flow.preview.length - 1 ? (
                    <div className="my-1.5 flex justify-center text-muted-foreground">↓</div>
                  ) : null}
                </div>
              ))}
              {flow.steps > flow.preview.length ? (
                <div className="mt-2 text-center font-mono text-[10px] text-muted-foreground">
                  {t('more', { count: flow.steps - flow.preview.length })}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
