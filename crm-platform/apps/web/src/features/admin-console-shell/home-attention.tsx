'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useBellFeed, useHealthSnapshot } from './header/api';
import { pillFor } from './header/header-logic';
import { useHeadline } from './header/use-headline';

const SHOWN = 5;

/**
 * The top of the console home: what needs a person right now. It reads the two sources the header already polls (the health
 * snapshot and the notification feed), so it adds no endpoint; a source that fails shows nothing for itself and never breaks the page.
 */
export function HomeAttention() {
  const t = useTranslations('admin-console-shell.overview');
  const th = useTranslations('admin-console-shell.header.health');
  const headline = useHeadline();
  const pill = pillFor(useHealthSnapshot(true));
  const feed = useBellFeed(true).data;
  const unread = (feed?.items ?? []).filter((n) => n.unread).slice(0, SHOWN);

  const rows: Array<{ key: string; href: string; tone: 'warn' | 'down' | 'info'; text: string }> =
    [];
  if (pill.state === 'down') {
    rows.push({ key: 'health', href: '/admin/health', tone: 'down', text: th('down') });
  } else if (pill.state === 'warn') {
    rows.push({
      key: 'health',
      href: '/admin/health',
      tone: 'warn',
      text: th('stuck', { count: pill.stuck }),
    });
  }
  for (const n of unread) {
    rows.push({ key: n.id, href: n.actionUrl, tone: 'info', text: headline(n) });
  }

  return (
    <section aria-labelledby="home-attention" className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-attention" className="text-sm font-semibold uppercase tracking-wide">
          {t('attentionTitle')}
        </h2>
        {(feed?.unread ?? 0) > 0 && (
          <Link
            href="/admin/notifications"
            className="text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('attentionAll', { count: feed?.unread ?? 0 })}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p data-testid="home-attention-empty" className="mt-3 text-sm text-muted-foreground">
          {t('attentionEmpty')}
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    row.tone === 'down' && 'bg-danger',
                    row.tone === 'warn' && 'bg-warning',
                    row.tone === 'info' && 'bg-primary',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{row.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
