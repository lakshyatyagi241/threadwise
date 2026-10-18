'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AnalyticsPanels } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { usePanels } from '../api/hooks';
import type { AnalyticsParams } from '../api/service';
import { compact, minutesLabel, relativeSpan } from '../lib/format';
import { Panel } from './parts';

/** The analytics list panels (TW-DASH-026, 028, 030): by device, top templates, top conversations, team performance. */
export function AnalyticsPanelsSection({ params }: { params: AnalyticsParams }) {
  const q = usePanels(params);
  if (!q.data) return null;
  return <Panels data={q.data} />;
}

function Panels({ data }: { data: AnalyticsPanels }) {
  const t = useTranslations('dashboards-analytics-charts.analytics.panels');
  const locale = useLocale();
  const now = new Date();
  const deviceMax = Math.max(...data.devices.rows.map((d) => d.sent), 1);
  const geoMax = Math.max(...data.geo.map((g) => g.count), 1);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title={t('devices.title')}
          subtitle={t('devices.subtitle')}
          action={
            <Badge tone="success">
              {t('devices.online', { online: data.devices.online, total: data.devices.total })}
            </Badge>
          }
        >
          {data.devices.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('devices.empty')}</p>
          ) : (
            <ul aria-label={t('devices.title')} className="space-y-2 text-sm">
              {data.devices.rows.map((d) => (
                <li key={d.uuid} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{d.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('devices.msg', { n: d.sent })}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(d.sent / deviceMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('templates.title')} subtitle={t('templates.subtitle')}>
          {data.templates.every((x) => x.sends === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('templates.empty')}</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.templates.map((x, i) => (
                <li key={x.uuid} className="flex items-center gap-3">
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{x.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[x.category, x.language?.toUpperCase()].filter(Boolean).join(' - ')}
                    </span>
                  </span>
                  <span className="tabular-nums">{compact(x.sends)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title={t('contacts.title')} subtitle={t('contacts.subtitle')}>
          {data.contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('contacts.empty')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.contacts.map((c) => (
                <li key={c.uuid} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase text-primary"
                  >
                    {c.title.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.phone, c.lastAt && relativeSpan(c.lastAt, now, locale)]
                        .filter(Boolean)
                        .join(' - ')}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {t('contacts.msgs', { n: c.messages })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={t('geo.title')}
          subtitle={t('geo.subtitle')}
          action={<Badge>{t('geo.markets', { n: data.geo.length })}</Badge>}
        >
          {data.geo.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('geo.empty')}</p>
          ) : (
            <ul aria-label={t('geo.title')} className="space-y-2 text-sm">
              {data.geo.map((g) => (
                <li key={g.code ?? 'none'} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono">{g.code ?? t('geo.unspecified')}</span>
                    <span className="tabular-nums text-muted-foreground">{compact(g.count)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(g.count / geoMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('events.title')} subtitle={t('events.subtitle')}>
          {data.events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('events.empty')}</p>
          ) : (
            <ul aria-label={t('events.title')} className="space-y-2 text-sm">
              {data.events.map((e) => (
                <li key={e.uuid} className="flex items-start gap-3">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {e.direction === 'out'
                        ? t('events.sent', { peer: e.peer })
                        : t('events.received', { peer: e.peer })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {relativeSpan(e.at, now, locale)} · {e.kind} · {e.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <LoginDevicesPanel data={data.loginDevices} />

      {data.team.length > 0 && (
        <Panel
          title={t('team.title')}
          subtitle={t('team.subtitle')}
          action={<Badge>{t('team.count', { n: data.team.length })}</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  {(['agent', 'convos', 'resolved', 'first', 'resolution', 'csat'] as const).map(
                    (c) => (
                      <th key={c} scope="col" className="py-2 pe-3 text-start font-medium">
                        {t(`team.col.${c}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.team.map((r) => (
                  <tr key={r.userUuid} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pe-3">
                      <span className="block font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.email}</span>
                    </td>
                    <td className="py-2 pe-3 tabular-nums">{r.conversations}</td>
                    <td className="py-2 pe-3 tabular-nums">{r.resolved}</td>
                    <td className="py-2 pe-3 tabular-nums">
                      {minutesLabel(r.avgFirstResponseMin)}
                    </td>
                    <td className="py-2 pe-3 tabular-nums">{minutesLabel(r.avgResolutionMin)}</td>
                    <td className="py-2 tabular-nums">
                      {r.csatAvg === null ? '-' : `${r.csatAvg.toFixed(2)} (${r.csatCount})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

type LoginBucket = { key: string; count: number; active: number };

/** Login devices: workspace sign-ins (`auth_sessions`) in the window as bars by browser, system and type; separate from the WhatsApp-number card above. */
function LoginDevicesPanel({ data }: { data: AnalyticsPanels['loginDevices'] }) {
  const t = useTranslations('dashboards-analytics-charts.analytics.panels.loginDevices');
  const groups = [
    { id: 'browser', rows: data.byBrowser },
    { id: 'os', rows: data.byOs },
    { id: 'kind', rows: data.byKind },
  ] as const;
  const max = Math.max(...data.byBrowser.map((r) => r.count), 1);
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      action={<Badge tone="success">{t('active', { n: data.active })}</Badge>}
    >
      {data.total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-3">
            {groups.map((g) => (
              <section key={g.id} aria-label={t(`group.${g.id}`)} className="space-y-2">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  {t(`group.${g.id}`)}
                </h4>
                <ul className="space-y-2 text-sm">
                  {g.rows.map((r: LoginBucket) => (
                    <li
                      key={r.key}
                      className="space-y-1"
                      aria-label={`${t(`${g.id}.${r.key}`)}: ${t('row', { count: r.count, active: r.active })}`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{t(`${g.id}.${r.key}`)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {compact(r.count)}
                        </span>
                      </div>
                      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${(r.active / max) * 100}%` }}
                        />
                        <div
                          className="h-full bg-primary/35"
                          style={{ width: `${((r.count - r.active) / max) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-primary" />
              {t('activeLegend')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-primary/35" />
              {t('endedLegend')}
            </span>
            <span className="ms-auto tabular-nums">{t('total', { n: data.total })}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
