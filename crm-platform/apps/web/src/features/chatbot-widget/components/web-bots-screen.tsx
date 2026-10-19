'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { WebBotItem, WebBotState } from '@crm/contracts';
import { EmptyState, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { newHref, openHref } from '@/features/flow-builder-editor/lib/builder-mode';
import { useWebBots } from '../api/widgets';

const PILL: Record<WebBotState, string> = {
  live: 'bg-success/15 text-success',
  needs_customizing: 'bg-warning/15 text-warning',
  draft: 'bg-muted text-muted-foreground',
  paused: 'bg-muted text-muted-foreground',
};

const LINK =
  'rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:border-brand hover:text-brand';

/**
 * Settings > Channels > Web: every website chat bot of the workspace beside the widget it owns. Nothing is edited here; each row
 * jumps to that bot's Customize or Install tab in the builder the workspace uses.
 */
export function WebBotsScreen() {
  const t = useTranslations('chatbotWidget.webBots');
  const canCreate = useCan('flb.flows.create');
  const list = useWebBots();

  const open = (bot: WebBotItem, tab?: 'customize' | 'deploy') =>
    `${openHref(bot.flowId, 'web')}${tab ? `?tab=${tab}` : ''}`;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{t('title')}</h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        {canCreate ? (
          <Link
            href={newHref('web')}
            className="rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground hover:opacity-90"
          >
            {t('create')}
          </Link>
        ) : null}
      </div>

      {list.isPending ? (
        <div className="flex justify-center p-16">
          <Spinner label={t('loading')} />
        </div>
      ) : list.isError ? (
        <p role="alert" className="p-8 text-center text-[13px] text-danger">
          {t('loadError')}
        </p>
      ) : list.data.data.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyBody')}
          actions={
            canCreate ? (
              <Link
                href={newHref('web')}
                className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground"
              >
                {t('create')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-background">
            {list.data.data.map((bot) => (
              <li
                key={bot.flowId}
                data-testid="web-bot-row"
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <Link
                    href={open(bot)}
                    className="block truncate text-[14px] font-semibold hover:text-brand"
                  >
                    {bot.name}
                  </Link>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {bot.widget
                      ? t('widgetLine', { title: bot.widget.headerTitle })
                      : t('noWidget')}
                  </div>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                    PILL[bot.state],
                  )}
                >
                  {t(`state.${bot.state}`)}
                </span>
                <div className="flex gap-2">
                  <Link href={open(bot, 'customize')} className={LINK}>
                    {t('customize')}
                  </Link>
                  {bot.widget ? (
                    <Link href={open(bot, 'deploy')} className={LINK}>
                      {t('deploy')}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.data.length ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t('more', { shown: list.data.data.length, total: list.data.total })}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
