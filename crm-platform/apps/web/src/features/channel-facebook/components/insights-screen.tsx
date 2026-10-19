'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Spinner, cn } from '@crm/ui';
import { AreaChart } from '@/features/broadcasts/components/charts';
import { useInsights } from '../api/facebook';
import {
  dayLabel,
  engagementRate,
  formatCount,
  initial,
  mixRows,
  relativeTime,
  shorten,
} from '../lib/format';
import { FB_BLUE, FacebookGlyph, ImageIcon } from './fb-icons';
import { PageSelect } from './page-select';

/** Post types and thread statuses in Reference's order and colours. Text posts count in the total but have no row, as in Reference. */
const TYPE_ORDER = ['photo', 'multi_photo', 'link', 'video', 'reel'] as const;
const TYPE_COLOR: Record<(typeof TYPE_ORDER)[number], string> = {
  photo: '#1877F2',
  multi_photo: '#42A5F5',
  link: '#7E57C2',
  video: '#26A69A',
  reel: '#EC407A',
};
const CONVO_ORDER = ['open', 'resolved', 'closed', 'snoozed'] as const;
const CONVO_COLOR: Record<(typeof CONVO_ORDER)[number], string> = {
  open: 'bg-success',
  resolved: 'bg-brand',
  closed: 'bg-muted-foreground',
  snoozed: 'bg-danger',
};
const linkBtn =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/** `/facebook/insights` (TW-FB-019): the Page's identity, live 28 day metrics beside what this system knows, a 14 day message trend and recent posts. */
export function InsightsScreen() {
  const t = useTranslations('facebook.insights');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { effectiveTimezone } = useSession();
  const tz = effectiveTimezone || 'UTC';
  const q = useInsights(search.get('page') ?? undefined, tz);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const d = q.data;
  const now = new Date();

  const cards = d
    ? [
        {
          label: t('cards.followers'),
          value: d.followers,
          sub: t('cards.followersSub'),
          live: true,
        },
        {
          label: t('cards.reach'),
          value: d.kpis.page_impressions_unique,
          sub: t('cards.reachSub'),
          live: true,
        },
        {
          label: t('cards.impressions'),
          value: d.kpis.page_impressions,
          sub: t('cards.impressionsSub'),
          live: true,
        },
        {
          label: t('cards.engagements'),
          value: d.kpis.page_post_engagements,
          sub: t('cards.engagementsSub'),
          live: true,
        },
        {
          label: t('cards.convos'),
          value: d.local.convos,
          sub: t('cards.convosSub', { n: d.local.convosOpen }),
          live: false,
        },
        {
          label: t('cards.messagesIn'),
          value: d.local.msgIn,
          sub: t('cards.messagesInSub', { n: formatCount(d.local.msgOut, locale) }),
          live: false,
        },
        {
          label: t('cards.published'),
          value: d.local.postsPublished,
          sub: t('cards.publishedSub', { n: d.local.postsScheduled }),
          live: false,
        },
        {
          label: t('cards.rate'),
          value: engagementRate(d.kpis.page_post_engagements, d.kpis.page_impressions_unique),
          suffix: '%',
          sub: t('cards.rateSub'),
          live: true,
        },
      ]
    : [];
  const contentTotal = d ? Object.values(d.contentMix).reduce((a, b) => a + b, 0) : 0;
  const convoTotal = d ? Object.values(d.convoMix).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/facebook/posts/create" className={linkBtn}>
            {t('create')}
          </Link>
          <Link href="/facebook/my-posts" className={linkBtn}>
            {t('myPosts')}
          </Link>
        </div>
      </div>

      {q.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !d || !d.page || !d.identity ? (
        <div className="rounded-2xl border border-border bg-background p-8 text-center">
          <span
            className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-6" />
          </span>
          <p className="text-[13.5px]">{t('noPage')}</p>
          <Link
            href="/facebook"
            className="mt-3 inline-flex rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            {t('connect')}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              {d.identity.avatar && !avatarBroken ? (
                <img
                  src={d.identity.avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                  className="size-14 shrink-0 rounded-2xl border border-border bg-muted object-cover"
                />
              ) : (
                <span
                  className="grid size-14 shrink-0 place-items-center rounded-2xl text-[22px] font-semibold text-white"
                  style={{ background: FB_BLUE }}
                >
                  {initial(d.identity.name)}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-semibold">{d.identity.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    {t('connected')}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{d.identity.category}</span>
                  {d.identity.username && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">@{d.identity.username}</span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <span className="font-mono">ID {shorten(d.identity.pageId, 10)}</span>
                </div>
              </div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('viewing')}
              </div>
              {d.pages.length > 1 ? (
                <PageSelect
                  pages={d.pages}
                  value={d.page.id}
                  label={t('viewing')}
                  onChange={(id) => router.replace(`${pathname}?page=${id}`)}
                  className="sm:w-64"
                />
              ) : (
                <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-[13px] font-semibold">
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-full text-white"
                    style={{ background: FB_BLUE }}
                  >
                    <FacebookGlyph className="size-3" />
                  </span>
                  {d.page.name || d.page.pageId}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-[14px] border border-border bg-background p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {c.label}
                  </div>
                  <span
                    title={c.live ? t('liveFromFacebook') : t('fromHere')}
                    className={cn('size-1.5 rounded-full', !c.live && 'bg-success')}
                    style={c.live ? { background: FB_BLUE } : undefined}
                  />
                </div>
                <div className="mt-2 text-[30px] leading-none">
                  {c.value === null || c.value === undefined
                    ? '—'
                    : `${formatCount(c.value, locale)}${'suffix' in c ? (c.suffix ?? '') : ''}`}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{c.sub}</div>
              </div>
            ))}
          </div>

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('activity')}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: FB_BLUE }} />
                  {t('received')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-success" />
                  {t('sent')}
                </span>
              </div>
            </div>
            <div className="p-4">
              <AreaChart
                label={t('activity')}
                labels={d.trend.days.map((day) => dayLabel(day, locale))}
                series={[
                  { name: t('received'), color: FB_BLUE, data: d.trend.in },
                  { name: t('sent'), color: 'var(--success)', data: d.trend.out },
                ]}
              />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
              <div className="border-b border-border px-5 py-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('mix.title')} · {t('mix.posts', { n: contentTotal })}
              </div>
              <div className="space-y-3 p-5">
                {contentTotal > 0 ? (
                  mixRows(d.contentMix, TYPE_ORDER).map((r) => (
                    <div key={r.key}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ background: TYPE_COLOR[r.key as keyof typeof TYPE_COLOR] }}
                          />
                          {t(`types.${r.key}`)}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {r.n} · {r.pct}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${r.pct}%`,
                            background: TYPE_COLOR[r.key as keyof typeof TYPE_COLOR],
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-[12.5px] text-muted-foreground">
                    {t('mix.none')}
                    <Link
                      href="/facebook/posts/create"
                      className="mt-2 block font-semibold text-brand hover:underline"
                    >
                      {t('mix.first')}
                    </Link>
                  </div>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
              <div className="border-b border-border px-5 py-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('convos.title')} · {t('convos.total', { n: convoTotal })}
              </div>
              <div className="space-y-3 p-5">
                {convoTotal > 0 ? (
                  <>
                    {mixRows(d.convoMix, CONVO_ORDER).map((r) => (
                      <div key={r.key}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                'size-2.5 rounded-full',
                                CONVO_COLOR[r.key as keyof typeof CONVO_COLOR],
                              )}
                            />
                            {t(`status.${r.key}`)}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {r.n} · {r.pct}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              CONVO_COLOR[r.key as keyof typeof CONVO_COLOR],
                            )}
                            style={{ width: `${r.pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/inbox"
                      className="mt-2 inline-flex text-xs font-semibold text-brand hover:underline"
                    >
                      {t('convos.open')} →
                    </Link>
                  </>
                ) : (
                  <div className="py-6 text-center text-[12.5px] text-muted-foreground">
                    {t('convos.none')}
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('recent.title')}
            </div>
            <div className="divide-y divide-border">
              {d.posts.length === 0 ? (
                <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
                  {t('recent.none')}
                </div>
              ) : (
                d.posts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                    {p.picture ? (
                      <img
                        src={p.picture}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="size-12 shrink-0 rounded-lg bg-muted object-cover"
                      />
                    ) : (
                      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <ImageIcon className="size-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-[12.5px]">
                        {p.message || t('recent.noCaption')}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                        <span>{relativeTime(p.created, now, locale)}</span>
                        {p.status && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                            {p.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-5 text-end">
                      <div>
                        <div className="text-lg leading-none">
                          {formatCount(p.stats.impressions, locale)}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {t('recent.impressions')}
                        </div>
                      </div>
                      <div>
                        <div className="text-lg leading-none">
                          {formatCount(p.stats.engaged, locale)}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {t('recent.engaged')}
                        </div>
                      </div>
                      {p.permalink && (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-medium text-brand hover:underline"
                        >
                          {t('recent.view')}
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <p className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: FB_BLUE }} />
              {t('legendLive')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              {t('legendHere')}
            </span>
          </p>
        </>
      )}
    </main>
  );
}
