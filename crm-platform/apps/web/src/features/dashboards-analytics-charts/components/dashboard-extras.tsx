'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DashWidgets } from '@crm/contracts';
import { Card, cn } from '@crm/ui';
import { compact, followersLabel } from '../lib/format';

const BASE = 'dashboards-analytics-charts.dashboard';
const IG_GRADIENT = 'linear-gradient(135deg,#833AB4,#E1306C,#F77737)';

/** The account chips and header strip of the Instagram band; shared by the dashboard and analytics (WD-DASH-008). */
export function InstagramChips({ data }: { data: NonNullable<DashWidgets['instagram']> }) {
  const t = useTranslations(`${BASE}.instagram`);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span
            aria-hidden
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-white"
            style={{ background: IG_GRADIENT }}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </span>
          {t('title')}
          <span className="normal-case tracking-normal">
            · {t('accounts', { count: data.accountsCount })}
          </span>
        </span>
        {data.accounts.slice(0, 4).map((a) => (
          <span
            key={a.handle}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pe-3 ps-1"
          >
            {a.avatar ? (
              <img src={a.avatar} alt="" className="size-5 rounded-full object-cover" />
            ) : (
              <span
                aria-hidden
                className="inline-flex size-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: IG_GRADIENT }}
              >
                {a.handle.replace(/^@/, '').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-[11px] font-medium">{a.handle}</span>
            <span
              role="img"
              aria-label={a.status.toLowerCase() === 'connected' ? t('connected') : a.status}
              className={cn(
                'size-1.5 rounded-full',
                a.status.toLowerCase() === 'connected' ? 'bg-success' : 'bg-warning',
              )}
            />
          </span>
        ))}
      </div>
      <Link
        href="/inbox"
        className="shrink-0 text-[11px] font-semibold hover:underline"
        style={{ color: '#C13584' }}
      >
        {t('openInbox')}
      </Link>
    </div>
  );
}

/** Dashboard Instagram band: five tiles under the WhatsApp KPI row; absent until an account is linked (WD-DASH-008). */
export function InstagramBand({ data }: { data: NonNullable<DashWidgets['instagram']> }) {
  const t = useTranslations(`${BASE}.instagram`);
  const tiles: Array<{ key: string; value: string; href?: string }> = [
    { key: 'needReply', value: data.needsReply.toLocaleString(), href: '/inbox' },
    { key: 'openChats', value: data.open.toLocaleString(), href: '/inbox' },
    { key: 'dmsIn', value: data.dmsIn7d.toLocaleString() },
    { key: 'dmsOut', value: data.dmsOut7d.toLocaleString() },
    { key: 'followers', value: followersLabel(data.followers) },
  ];
  return (
    <section aria-label={t('title')} className="space-y-3" data-testid="ig-band">
      <InstagramChips data={data} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((x) => {
          const body = (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.09]"
                style={{ background: IG_GRADIENT }}
              />
              <span className="relative font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {t(`tile.${x.key}`)}
              </span>
              <div
                className="relative mt-4 font-serif text-4xl leading-none tabular-nums"
                style={{
                  background: 'linear-gradient(120deg,#833AB4,#C13584,#E1306C,#F77737)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {x.value}
              </div>
            </>
          );
          const cls =
            'relative block overflow-hidden rounded-2xl border bg-card p-5 shadow-sm [border-color:rgba(225,48,108,0.2)]';
          return x.href ? (
            <Link key={x.key} href={x.href} className={cls}>
              {body}
            </Link>
          ) : (
            <div key={x.key} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The fixed example prompt of the Copilot card; the flow builder reads it from `?ai_prompt=` (WD-DASH-017). */
export const COPILOT_EXAMPLE =
  'When a WooCommerce order is paid, send a thank-you with tracking link. After 24h, ask for a 5-star review and offer a 10% off coupon.';

/** "{brand} Copilot" promo card with the flow counters (WD-DASH-017). */
export function CopilotCard({ data }: { data: DashWidgets['flows'] }) {
  const t = useTranslations(`${BASE}.copilot`);
  const brand = useTranslations('common')('appName');
  const stats = [
    ['flows', data.total],
    ['active', data.active],
    ['subscribers', data.subscribers],
  ] as const;
  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-foreground p-5 text-background shadow-md"
      data-testid="card-copilot"
      aria-label={t('title', { brand })}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-primary-foreground"
        >
          AI
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest opacity-60">
          {t('title', { brand })}
        </span>
        <span className="ms-auto rounded-full bg-background/15 px-2.5 py-1 font-mono text-[11px] opacity-80">
          {t('tag')}
        </span>
      </div>
      <p className="mt-3 font-serif text-[22px] leading-tight">{t('headline')}</p>
      <p className="mt-1.5 text-xs opacity-70">{t('body')}</p>
      <div className="mt-3 rounded-xl border border-background/10 bg-background/5 p-3">
        <div className="mb-1 font-mono text-[10px] opacity-50">{t('try')}</div>
        <div className="text-xs leading-snug">&ldquo;{COPILOT_EXAMPLE}&rdquo;</div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/flows/builder?ai_prompt=${encodeURIComponent(COPILOT_EXAMPLE)}`}
          className="flex-1 rounded-full bg-primary py-2 text-center text-xs font-semibold text-primary-foreground"
        >
          {t('generate')}
        </Link>
        <Link
          href="/flows/builder?ai=1"
          className="rounded-full border border-background/15 px-3 py-2 text-xs opacity-80 hover:bg-background/10"
        >
          {t('examples')}
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-background/10 bg-background/5 p-2">
            <dt className="opacity-50">{t(`stat.${k}`)}</dt>
            <dd className={cn('font-serif text-lg tabular-nums', k === 'active' && 'text-primary')}>
              {compact(v)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The six latest flows with trigger, steps and subscribers (WD-DASH-017). */
export function FlowsCard({ data }: { data: DashWidgets['flows'] }) {
  const t = useTranslations(`${BASE}.flows`);
  return (
    <Card className="flex flex-1 flex-col space-y-3" data-testid="card-flows">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[22px] leading-tight">{t('title')}</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            {t('summary', { active: data.active, subscribers: data.subscribers })}
          </p>
        </div>
        <Link
          href="/flows"
          className="mt-1 shrink-0 text-[11px] font-semibold text-primary hover:underline"
        >
          {t('open')}
        </Link>
      </div>
      {data.recent.length === 0 ? (
        <div className="grid flex-1 place-items-center px-4 py-6 text-center">
          <div>
            <p className="text-xs text-muted-foreground">{t('empty')}</p>
            <Link
              href="/flows/builder"
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t('build')}
            </Link>
          </div>
        </div>
      ) : (
        <ul>
          {data.recent.map((f) => (
            <li key={f.uuid} className="border-b border-border last:border-0">
              <Link
                href="/flows"
                className="-mx-2 flex min-h-[52px] items-center gap-3 rounded-lg px-2 text-[13px] hover:bg-muted/50"
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    f.active ? 'bg-success' : 'bg-muted-foreground/40',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-tight">{f.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                    {t('meta', {
                      trigger: f.trigger.charAt(0).toUpperCase() + f.trigger.slice(1),
                      steps: f.steps,
                      subs: f.subscribers,
                    })}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]',
                    f.active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {f.active ? t('statusActive') : t('statusPaused')}
                </span>
                <span className="w-[58px] shrink-0 text-end font-semibold tabular-nums">
                  {compact(f.subscribers)}{' '}
                  <span className="text-[10px] font-normal text-muted-foreground">{t('subs')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** `live: false` = the screen is not built yet (auto-reply, WD-AR): the tile shows "Soon" instead of linking to a 404. */
const QUICK_ACTIONS = [
  { key: 'broadcast', href: '/broadcasts/create', tone: 'bg-primary', live: true },
  { key: 'flow', href: '/flows', tone: 'bg-foreground', live: true },
  { key: 'template', href: '/templates/new', tone: 'bg-warning', live: true },
  { key: 'autoReply', href: '/auto-reply', tone: 'bg-danger', live: false },
] as const;

/** Four shortcut buttons (WD-DASH-020). */
export function QuickActionsCard() {
  const t = useTranslations(`${BASE}.quickActions`);
  return (
    <Card className="space-y-3" data-testid="card-quick-actions">
      <h2 className="font-serif text-[22px] leading-tight">{t('title')}</h2>
      <div className="grid grid-cols-2 gap-2">
        {QUICK_ACTIONS.map((a) => {
          const body = (
            <>
              <span aria-hidden className={cn('mb-2 block size-7 rounded-lg', a.tone)} />
              <div className="flex items-center justify-between gap-1">
                <div className="text-xs font-medium">{t(`${a.key}.label`)}</div>
                {!a.live && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('soon')}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">{t(`${a.key}.hint`)}</div>
            </>
          );
          return a.live ? (
            <Link
              key={a.key}
              href={a.href}
              className="block rounded-xl border border-border p-3 text-start hover:bg-muted/50"
            >
              {body}
            </Link>
          ) : (
            <div
              key={a.key}
              aria-disabled="true"
              className="block rounded-xl border border-border p-3 text-start opacity-60"
            >
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const INTEGRATION_BADGE = {
  woocommerce: { badge: 'Wo', bg: '#7F54B3' },
  shopify: { badge: 'Sh', bg: '#96BF48' },
  google_sheets: { badge: 'Sh', bg: '#0F9D58' },
  meta_catalog: { badge: 'FB', bg: '#1877F2' },
} as const;

/** Four integrations with a connected dot or a Connect link, counted against the real catalog (WD-DASH-020). */
export function IntegrationsCard({ data }: { data: DashWidgets['integrations'] }) {
  const t = useTranslations(`${BASE}.integrations`);
  return (
    <Card className="space-y-3" data-testid="card-integrations">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[22px] leading-tight">{t('title')}</h2>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px]">
          {data.connected} / {data.total}
        </span>
      </div>
      <ul className="space-y-2">
        {data.rows.map((r) => (
          <li
            key={r.code}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border p-2.5',
              !r.connected && 'opacity-60',
            )}
          >
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded font-mono text-[9px] font-bold text-white"
              style={{
                backgroundColor: r.connected ? INTEGRATION_BADGE[r.code].bg : '#E5E2D5',
                color: r.connected ? undefined : '#4A4A4A',
              }}
            >
              {INTEGRATION_BADGE[r.code].badge}
            </span>
            <div className="flex-1">
              <div className="text-xs font-medium">{t(`name.${r.code}`)}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {r.connected
                  ? r.events7d !== null
                    ? t('events', { n: r.events7d })
                    : t(`connected.${r.code}`)
                  : t('notConnected')}
              </div>
            </div>
            {r.connected ? (
              <span
                role="img"
                aria-label={t('connectedLabel')}
                className="size-1.5 rounded-full bg-success"
              />
            ) : (
              <Link href="/integrations" className="text-[10px] font-medium text-primary">
                {t('connect')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Analytics' Instagram strip: the same data as six stats under a gradient rule (WD-DASH-008). Always the last 7 days. */
export function InstagramAnalytics({ data }: { data: NonNullable<DashWidgets['instagram']> }) {
  const t = useTranslations(`${BASE}.instagram`);
  const stats = [
    ['dmsIn', data.dmsIn7d.toLocaleString()],
    ['dmsOut', data.dmsOut7d.toLocaleString()],
    ['replyRate', `${data.replyRatePct}%`],
    ['needReply', data.needsReply.toLocaleString()],
    ['openChats', data.open.toLocaleString()],
    ['followers', followersLabel(data.followers)],
  ] as const;
  return (
    <section
      aria-label={t('title')}
      className="overflow-hidden rounded-2xl border border-border bg-card"
      data-testid="ig-analytics"
    >
      <div
        aria-hidden
        className="h-1"
        style={{
          background: 'linear-gradient(90deg,#405DE6,#833AB4,#C13584,#E1306C,#F77737,#FCAF45)',
        }}
      />
      <div className="space-y-3 p-4">
        <InstagramChips data={data} />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dd className="font-serif text-[22px] leading-none">{v}</dd>
              <dt className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {t(`tile.${k}`)}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
