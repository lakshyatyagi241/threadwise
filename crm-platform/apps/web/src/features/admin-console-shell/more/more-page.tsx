'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  deviceHealth,
  overviewStatsResponseSchema,
  weekDelta,
  type OverviewStatsResponse,
} from '@crm/contracts';
import { Button, Input, Modal, cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { SEARCH_EVENT } from '@/components/shell/command-palette-model';
import { Crown } from '@/components/shell/top-nav';
import { useShellData } from '@/components/shell/shell-data';
import { demotedBarItems, resolveTopBar } from '@/components/shell/topbar-model';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { apiFetch } from '@/lib/api/client';
import { useStoredValue } from '@/lib/use-stored-value';
import { CATALOGUE } from './more-catalogue';
import {
  DEFAULT_SHORTCUT_IDS,
  SHORTCUT_PRESETS,
  SHORTCUT_SUBTITLE_MAX,
  SHORTCUT_TITLE_MAX,
  SHORTCUT_URL_MAX,
  TOOL_CATEGORIES,
  activityBadge,
  activityLabel,
  addShortcut,
  allToolCards,
  filterCards,
  loadShortcuts,
  moveShortcut,
  normaliseHref,
  storageKey,
  type Shortcut,
  type Tone,
  type ToolCard,
} from './more-model';
import { footValues } from './more-stats';

const NS = 'admin-console-shell.more';
const TIP_IDS = ['templates', 'flows', 'palette', 'scheduled', 'wallet'] as const;
const TIP_HREF: Record<(typeof TIP_IDS)[number], string | null> = {
  templates: '/templates',
  flows: '/flows',
  palette: null,
  scheduled: '/scheduled',
  wallet: '/billing/wallet',
};
const TIP_ROTATE_MS = 7000;

/** Icon tile tints. Brand colours stay fixed (Meta blue, LINE green); the rest follow the theme tokens. */
const TONES: Record<Tone, string> = {
  mint: 'bg-primary/10 text-primary',
  blue: 'bg-[#E7F0FF] text-[#1877F2] dark:bg-[#1877F2]/20',
  insta: 'bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737] text-white',
  line: 'bg-[#06C755] text-white',
  wechat: 'bg-[#07C160] text-white',
  viber: 'bg-[#7360F2] text-white',
  dark: 'bg-foreground text-background',
  teal: 'bg-[#E0F2F1] text-primary dark:bg-primary/15',
  amber: 'bg-[#FFF4E0] text-[#7B5A14] dark:bg-[#7B5A14]/25 dark:text-[#F3D9A4]',
  amber2: 'bg-[#FEF3E2] text-[#7B5A14] dark:bg-[#7B5A14]/25 dark:text-[#F3D9A4]',
  violet: 'bg-[#F3E9FF] text-[#5B3D8A] dark:bg-[#5B3D8A]/30 dark:text-[#D9C4F5]',
  sky: 'bg-[#D9E5F2] text-[#13478A] dark:bg-[#13478A]/30 dark:text-[#BBD3EE]',
  bubble: 'bg-[#DCF8C6] text-primary dark:bg-primary/20',
  neutral: 'bg-muted text-foreground',
  green: 'bg-[#E8F5E9] text-primary dark:bg-primary/15',
  google: 'bg-[#E8F0FE] text-[#1A73E8] dark:bg-[#1A73E8]/25',
};
const BADGE_TONES: Record<string, string> = {
  blue: 'bg-[#E7F0FF] text-[#1877F2] dark:bg-[#1877F2]/20',
  insta: 'bg-[#FCE7F3] text-[#9D174D]',
  mint: 'bg-primary/10 text-primary',
  line: 'bg-[#EAF9F0] text-[#0B8043]',
  wechat: 'bg-[#E9F9EE] text-[#0A7C3E]',
  viber: 'bg-[#EEEBFD] text-[#5B47C7]',
  dark: 'bg-muted text-foreground',
};

const useOverviewStats = () =>
  useQuery({
    queryKey: ['shell', 'overview-stats'] as const,
    queryFn: ({ signal }) =>
      apiFetch('/shell/overview-stats', { schema: overviewStatsResponseSchema, signal }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

const mono = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const HEALTH_TONE = {
  healthy: 'text-primary',
  partial: 'text-warning',
  offline: 'text-danger',
  none: 'text-muted-foreground',
} as const;

/**
 * The More hub (TW-ASHELL-020), laid out like Reference's: a header, a four-figure live strip, the Navigation strip for entries the
 * admin took out of the bar, the All tools grid with its tabs, and a side column (recent activity, affiliate, quick access, plan,
 * a rotating tip, what's new, small tips); the shortcut strip (TW-ASHELL-021) sits below. Numbers come from one read,
 * `GET /v2/shell/overview-stats`; while it loads or if it fails the cards simply show no figure.
 */
export function MorePage() {
  const t = useTranslations(NS);
  const tAll = useTranslations();
  const { nav, tiles, bar, walletLabel } = useShellData();
  const { org } = useSession();
  const stats = useOverviewStats();
  const s = stats.data;
  const [tab, setTab] = useState<(typeof TOOL_CATEGORIES)[number]>('all');

  const barHrefs = useMemo(
    () => new Set(resolveTopBar(bar, nav, tiles).map((b) => b.href)),
    [bar, nav, tiles],
  );
  const cards = useMemo(
    () => filterCards(allToolCards(CATALOGUE, nav, tiles, barHrefs), tab),
    [nav, tiles, barHrefs, tab],
  );
  const demoted = useMemo(() => demotedBarItems(bar, nav, tiles), [bar, nav, tiles]);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="font-serif text-xl italic leading-tight text-primary">{t('eyebrow')}</div>
          <h1 className="font-serif text-3xl leading-tight tracking-tight lg:text-4xl">
            {t('titleLead')} {t('titleTail')}
          </h1>
          <p className="max-w-[640px] text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-primary" />
            {t('sortedByUsage')}
          </div>
          <Link
            href="/workspace-settings?tab=api"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <NavIcon name="code" className="size-3.5" />
            {t('developers')}
          </Link>
        </div>
      </header>

      <StatsStrip s={s} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {demoted.length > 0 && (
            <div aria-label={t('navigation')} role="region">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-serif text-xl leading-tight">{t('navigation')}</h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t('movedOffHeader')}
                </span>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {demoted.map((d) => (
                  <li key={d.key}>
                    <Link
                      href={d.href}
                      className="group flex h-full flex-col rounded-[14px] border border-border bg-background p-4 shadow-sm outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span
                        className={cn('grid size-11 place-items-center rounded-xl', TONES.mint)}
                      >
                        {d.icon && <NavIcon name={d.icon} className="size-5" />}
                      </span>
                      <span className="mt-3 flex items-center gap-1.5 text-[13.5px] font-semibold">
                        {d.labelKey ? tAll(d.labelKey) : null}
                        {d.locked && <Crown />}
                      </span>
                      <span className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {t(`navDesc.${d.key}`)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-xl leading-tight">{t('allTools')}</h2>
              <div
                role="tablist"
                aria-label={t('allTools')}
                className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground"
              >
                {TOOL_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    role="tab"
                    type="button"
                    aria-selected={tab === c}
                    onClick={() => setTab(c)}
                    className={cn(
                      'rounded-full px-2.5 py-1 outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                      tab === c ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                    )}
                  >
                    {t(`tabs.${c}`)}
                  </button>
                ))}
              </div>
            </div>
            {cards.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t('noTools')}
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((c) => (
                  <li key={c.id}>
                    <ToolCardView card={c} stats={s} wallet={walletLabel} plan={org.plan} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <RecentActivity s={s} />
          <AffiliateCard s={s} />
          <QuickAccessCard />
          <PlanCard s={s} plan={org.plan} />
          <TipCard />
          <WhatsNew />
          <SmallTips />
        </aside>
      </div>

      <ShortcutStrip workspaceId={org.id} />
    </section>
  );
}

function StatsStrip({ s }: { s: OverviewStatsResponse | undefined }) {
  const t = useTranslations(`${NS}.strip`);
  const f = useFormatter();
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : f.number(v));
  const health = deviceHealth(s?.devicesActive ?? 0, s?.devicesTotal ?? 0);
  const fresh = weekDelta(s?.activeRulesNew ?? null);
  const box = 'rounded-[14px] border border-border bg-background p-4 shadow-sm';
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label={t('label')}>
      <div className={box}>
        <div className="flex items-center justify-between">
          <span className={mono}>{t('rules')}</span>
          <span className="font-mono text-[10px] text-primary">
            {fresh > 0 ? t('thisWeek', { count: fresh }) : t('noNew')}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-3xl leading-none">{n(s?.activeRules)}</span>
          <span className="text-[11px] text-muted-foreground">{t('rulesCaption')}</span>
        </div>
      </div>
      <div className={box}>
        <div className="flex items-center justify-between">
          <span className={mono}>{t('queued')}</span>
          <span className="font-mono text-[10px] text-warning">
            {s?.nextScheduledAt ? f.relativeTime(new Date(s.nextScheduledAt)) : t('noUpcoming')}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-3xl leading-none">{n(s?.scheduledQueued)}</span>
          <span className="text-[11px] text-muted-foreground">{t('queuedCaption')}</span>
        </div>
      </div>
      <div className={box}>
        <div className="flex items-center justify-between">
          <span className={mono}>{t('connected')}</span>
          <span className={cn('font-mono text-[10px]', HEALTH_TONE[health])}>
            {t(`health.${health}`)}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-3xl leading-none">
            {n(s?.devicesActive)} / {n(s?.devicesTotal)}
          </span>
          <span className="text-[11px] text-muted-foreground">{t('connectedCaption')}</span>
        </div>
      </div>
      <div className={box}>
        <div className="flex items-center justify-between">
          <span className={mono}>{t('notifications')}</span>
          <span className="font-mono text-[10px] text-primary">{t('unread')}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-3xl leading-none">{n(s?.unreadNotifications)}</span>
          <span className="text-[11px] text-muted-foreground">{t('notificationsCaption')}</span>
        </div>
      </div>
    </section>
  );
}

function ToolCardView({
  card,
  stats,
  wallet,
  plan,
}: {
  card: ToolCard;
  stats: OverviewStatsResponse | undefined;
  wallet: string | undefined;
  plan: string;
}) {
  const t = useTranslations(NS);
  const tAll = useTranslations();
  const f = useFormatter();
  const id = card.catalogueId;
  const vals = id
    ? footValues(id, stats, {
        plan,
        balance: wallet ?? '—',
        next: stats?.nextScheduledAt ? f.relativeTime(new Date(stats.nextScheduledAt)) : '—',
      })
    : null;
  const tone = card.tone ?? 'mint';
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('grid size-11 place-items-center rounded-xl', TONES[tone])}>
          {card.icon && <NavIcon name={card.icon} className="size-5" />}
        </span>
        {card.badge && id && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]',
              BADGE_TONES[tone] ?? BADGE_TONES.mint,
            )}
          >
            {t(`cards.${id}.badge`)}
          </span>
        )}
      </div>
      <h3 className="mt-4 flex items-center gap-1.5 text-base font-semibold leading-tight">
        {tAll(card.labelKey)}
        {card.locked && <Crown />}
      </h3>
      <p className="mt-1.5 flex-1 text-xs leading-snug text-muted-foreground">
        {card.descriptionKey ? tAll(card.descriptionKey) : null}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono">
          {id && vals ? t(`cards.${id}.foot`, vals) : null}
        </span>
        <span className="shrink-0 font-semibold text-primary group-hover:underline">
          {id ? t(`cards.${id}.open`) : t('open')}
        </span>
      </div>
    </>
  );
  const cls =
    'group flex h-full flex-col rounded-[14px] border border-border bg-background p-4 shadow-sm transition';
  // A crown card is not clickable (TW-ASHELL-020): the upgrade link is the plan card on the right.
  return card.locked ? (
    <div className={cn(cls, 'opacity-70')}>{body}</div>
  ) : (
    <Link
      href={card.href}
      className={cn(
        cls,
        'outline-none hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {body}
    </Link>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('rounded-[14px] border border-border bg-background p-4 shadow-sm', className)}
    >
      {children}
    </div>
  );
}

function RecentActivity({ s }: { s: OverviewStatsResponse | undefined }) {
  const t = useTranslations(`${NS}.activity`);
  const f = useFormatter();
  const rows = s?.recentActivity ?? [];
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <span className={mono}>{t('title')}</span>
        <Link
          href="/activity-log"
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          {t('viewAll')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const b = activityBadge(r.module);
            return (
              <li key={`${r.at}-${i}`} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-lg font-mono text-[10px]',
                    TONES[b.tone],
                  )}
                >
                  {b.code}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium leading-tight">
                    {activityLabel(r.module, r.action)}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {r.module.charAt(0).toUpperCase() + r.module.slice(1)} /{' '}
                    {f.relativeTime(new Date(r.at))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function AffiliateCard({ s }: { s: OverviewStatsResponse | undefined }) {
  const t = useTranslations(`${NS}.affiliate`);
  const f = useFormatter();
  return (
    <div className="relative flex min-h-[320px] flex-col overflow-hidden rounded-[14px] bg-brand p-5 text-brand-foreground shadow-md">
      <span className="absolute end-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px]">
        <span className="size-1.5 animate-pulse rounded-full bg-[#25D366]" />
        {t('badge')}
      </span>
      <span className="relative z-10 grid size-12 place-items-center rounded-xl bg-white/15">
        <NavIcon name="code" className="size-6" />
      </span>
      <h2 className="relative z-10 mt-4 font-serif text-[22px] leading-tight">{t('title')}</h2>
      <p className="relative z-10 mt-1.5 text-[12.5px] leading-snug opacity-85">{t('body')}</p>
      <div className="relative z-10 mt-4 space-y-2 font-mono text-[11.5px]">
        <div className="flex items-center justify-between">
          <span className="opacity-70">{t('referrals')}</span>
          <span>{s?.affiliateReferrals === null || !s ? '—' : f.number(s.affiliateReferrals)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="opacity-70">{t('payouts')}</span>
          <span className="opacity-60">{t('payoutsNote')}</span>
        </div>
      </div>
      <div className="relative z-10 mt-auto flex items-center justify-between border-t border-white/15 pt-4 text-[11px] opacity-80">
        <span className="font-mono">{t('foot')}</span>
      </div>
      <svg
        viewBox="0 0 200 120"
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-2 -end-2 h-32 w-48 opacity-10"
      >
        <rect x="10" y="40" width="80" height="22" rx="11" fill="#FBFAF6" />
        <rect x="100" y="68" width="80" height="22" rx="11" fill="#FBFAF6" />
        <rect x="40" y="96" width="60" height="14" rx="7" fill="#FBFAF6" />
      </svg>
    </div>
  );
}

function QuickAccessCard() {
  const t = useTranslations(`${NS}.quick`);
  const link =
    'rounded-[10px] bg-white/10 px-3 py-2 text-center text-xs font-semibold outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white';
  return (
    <div className="rounded-[14px] bg-brand p-4 text-brand-foreground shadow-md">
      <div className="font-serif text-[22px] leading-tight">{t('title')}</div>
      <p className="mt-2 text-xs leading-relaxed opacity-75">{t('body')}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href="/inbox" className={link}>
          {t('openChat')}
        </Link>
        <Link href="/settings/automation" className={link}>
          {t('addRule')}
        </Link>
      </div>
    </div>
  );
}

function PlanCard({ s, plan }: { s: OverviewStatsResponse | undefined; plan: string }) {
  const t = useTranslations(`${NS}.planCard`);
  const f = useFormatter();
  const sent = s?.messagesThisMonth ?? 0;
  // Reference's soft bar: it fills to the share of the month gone by, and is cosmetic (no cap is enforced).
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pct = Math.max(2, Math.min(100, Math.round((now.getDate() / days) * 100)));
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className={mono}>{t('title')}</span>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
          {plan}
        </span>
      </div>
      <div className="mt-2 font-serif text-xl capitalize">
        {t('seats', { plan, count: s?.seats ?? 1 })}
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>{t('messages')}</span>
          <span>{t('sent', { count: f.number(sent) })}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${sent > 0 ? pct : 0}%` }} />
        </div>
      </div>
      <Link
        href="/billing/wallet"
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        {t('manage')}
        <NavIcon name="chevron-right" className="size-3" />
      </Link>
    </Panel>
  );
}

/** One tip at a time, changing every 7 seconds, with a dot pager (TW-ASHELL-020). */
function TipCard() {
  const t = useTranslations(`${NS}.tips`);
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % TIP_IDS.length), TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [i]);
  const tip = TIP_IDS[i]!;
  const href = TIP_HREF[tip];
  const cta =
    'mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline';
  return (
    <Panel className="p-6">
      <div className="mb-2 flex items-center justify-between">
        <span className={cn(mono, 'inline-flex items-center gap-1.5')}>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3 text-warning"
            fill="currentColor"
          >
            <path d="M8 1l1.6 4.2L14 6l-3.5 2.5 1.4 4.3L8 10.5 4.1 12.8l1.4-4.3L2 6l4.4-.8z" />
          </svg>
          {t('title')}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label={t('pager')}>
          {TIP_IDS.map((id, n) => (
            <button
              key={id}
              type="button"
              aria-label={t(`${id}.title`)}
              aria-current={n === i}
              onClick={() => setI(n)}
              className={cn('size-1.5 rounded-full', n === i ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </div>
      </div>
      <h4 className="font-serif text-[15px] leading-tight">{t(`${tip}.title`)}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(`${tip}.body`)}</p>
      {href ? (
        <Link href={href} className={cta}>
          {t(`${tip}.cta`)}
        </Link>
      ) : (
        <button
          type="button"
          className={cta}
          onClick={() => window.dispatchEvent(new Event(SEARCH_EVENT))}
        >
          {t(`${tip}.cta`)}
        </button>
      )}
    </Panel>
  );
}

function WhatsNew() {
  const t = useTranslations(`${NS}.whatsNew`);
  return (
    <div className="relative overflow-hidden rounded-[14px] bg-brand p-5 text-brand-foreground shadow-md">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
          {t('title')}
        </span>
      </div>
      <h4 className="mt-2 font-serif text-lg leading-tight">{t('headline')}</h4>
      <ul className="mt-2.5 space-y-1.5 text-[11.5px] opacity-90">
        {(['inbox', 'ai', 'forecast'] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <NavIcon name="check" className="size-3 shrink-0 text-[#25D366]" />
            {t(`items.${k}`)}
          </li>
        ))}
      </ul>
      <Link
        href="/help"
        className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold"
      >
        {t('changelog')}
        <NavIcon name="chevron-right" className="size-3" />
      </Link>
    </div>
  );
}

const SMALL_TIPS = [
  { id: 'warm', icon: 'clock', tone: 'mint' },
  { id: 'tag', icon: 'tag', tone: 'sky' },
  { id: 'templates', icon: 'template', tone: 'violet' },
  { id: 'signing', icon: 'webhook', tone: 'amber' },
] as const;

function SmallTips() {
  const t = useTranslations(`${NS}.smallTips`);
  return (
    <>
      {SMALL_TIPS.map((tip) => (
        <div
          key={tip.id}
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 shadow-sm"
        >
          <span
            className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONES[tip.tone])}
          >
            <NavIcon name={tip.icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold leading-tight">{t(`${tip.id}.title`)}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {t(`${tip.id}.body`)}
            </p>
          </div>
        </div>
      ))}
    </>
  );
}

/** TW-ASHELL-021: the shortcuts strip and its customiser, kept in this browser, one list per workspace. */
function ShortcutStrip({ workspaceId }: { workspaceId: string | number }) {
  const t = useTranslations(`${NS}.shortcuts`);
  const key = storageKey(workspaceId);
  const [raw, setRaw] = useStoredValue(key);
  const defaults = useMemo<Shortcut[]>(
    () =>
      DEFAULT_SHORTCUT_IDS.map((id) => ({
        id,
        title: t(`presets.${id}.title`),
        subtitle: t(`presets.${id}.subtitle`),
        href: SHORTCUT_PRESETS[id]!.href,
        icon: SHORTCUT_PRESETS[id]!.icon,
      })),
    [t],
  );
  const list = useMemo(() => loadShortcuts(raw, defaults), [raw, defaults]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Shortcut[]>([]);
  const [custom, setCustom] = useState({ title: '', subtitle: '', href: '' });
  const [problem, setProblem] = useState(false);

  const open = () => {
    setDraft(list);
    setCustom({ title: '', subtitle: '', href: '' });
    setProblem(false);
    setEditing(true);
  };
  const addPreset = (id: string) => {
    const p = SHORTCUT_PRESETS[id];
    if (!p) return;
    const next = addShortcut(draft, {
      id,
      title: t(`presets.${id}.title`),
      subtitle: t(`presets.${id}.subtitle`),
      href: p.href,
      icon: p.icon,
    });
    if (next) setDraft(next);
  };

  return (
    <section aria-labelledby="shortcuts-title" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="shortcuts-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Button variant="secondary" size="sm" onClick={open}>
          {t('customise')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className="flex h-full flex-col gap-1 rounded-xl border border-border p-3 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <NavIcon name={s.icon} className="size-4 text-primary" />
                  {s.title}
                </span>
                {s.subtitle && <span className="text-xs text-muted-foreground">{s.subtitle}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={t('editTitle')} size="lg">
        <div className="space-y-4">
          <ul className="space-y-1">
            {draft.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              >
                <span className="truncate">{s.title}</span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('up', { item: s.title })}
                    onClick={() => setDraft(moveShortcut(draft, s.id, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('down', { item: s.title })}
                    onClick={() => setDraft(moveShortcut(draft, s.id, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('remove', { item: s.title })}
                    onClick={() => setDraft(draft.filter((x) => x.id !== s.id))}
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
            {draft.length === 0 && (
              <li className="text-sm text-muted-foreground">{t('emptyEditor')}</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SHORTCUT_PRESETS)
              .filter((id) => !draft.some((d) => d.id === id))
              .map((id) => (
                <Button key={id} size="sm" variant="secondary" onClick={() => addPreset(id)}>
                  + {t(`presets.${id}.title`)}
                </Button>
              ))}
          </div>
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const next = addShortcut(draft, {
                id: `custom-${Date.now()}`,
                title: custom.title,
                subtitle: custom.subtitle,
                href: custom.href,
                icon: 'link',
                custom: true,
              });
              if (!next) return setProblem(true);
              setProblem(false);
              setDraft(next);
              setCustom({ title: '', subtitle: '', href: '' });
            }}
          >
            <Input
              aria-label={t('customTitle')}
              placeholder={t('customTitle')}
              maxLength={SHORTCUT_TITLE_MAX}
              value={custom.title}
              onChange={(e) => setCustom({ ...custom, title: e.target.value })}
            />
            <Input
              aria-label={t('customSubtitle')}
              placeholder={t('customSubtitle')}
              maxLength={SHORTCUT_SUBTITLE_MAX}
              value={custom.subtitle}
              onChange={(e) => setCustom({ ...custom, subtitle: e.target.value })}
            />
            <Input
              aria-label={t('customUrl')}
              placeholder="/page"
              dir="ltr"
              maxLength={SHORTCUT_URL_MAX}
              value={custom.href}
              onChange={(e) => setCustom({ ...custom, href: e.target.value })}
            />
            {problem && <p className="text-xs text-danger sm:col-span-3">{t('customProblem')}</p>}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="sm:col-span-3 sm:justify-self-start"
            >
              {t('addCustom')}
            </Button>
          </form>
          <div className="flex justify-between border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setDraft(defaults)}>
              {t('reset')}
            </Button>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setRaw(JSON.stringify(draft.map((s) => ({ ...s, href: normaliseHref(s.href) }))));
                  setEditing(false);
                }}
              >
                {t('save')}
              </Button>
            </span>
          </div>
        </div>
      </Modal>
    </section>
  );
}
