'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { pillFor } from './header-logic';
import { useHealthSnapshot } from './api';

const DOT = { ok: 'bg-success', warn: 'bg-warning', down: 'bg-danger' } as const;

/** TW-ASHELL-006: "All systems normal", "N stuck jobs" or "Database unreachable"; hidden below md, links to the health screen. */
export function HealthPill({ enabled }: { enabled: boolean }) {
  const t = useTranslations('admin-console-shell.header.health');
  const pill = pillFor(useHealthSnapshot(enabled));
  const label =
    pill.state === 'down'
      ? t('down')
      : pill.state === 'warn'
        ? t('stuck', { count: pill.stuck })
        : t('ok');
  return (
    <Link
      href="/admin/health"
      title={t('title')}
      data-testid="health-pill"
      data-state={pill.state}
      className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary md:inline-flex"
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[pill.state])} />
      <span>{label}</span>
    </Link>
  );
}
