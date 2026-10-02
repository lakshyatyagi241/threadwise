'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { SettingsIcon } from './settings-icons';

function Pill({ tone, children }: { tone: 'soon' | 'upgrade'; children: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
        tone === 'soon' ? 'bg-muted text-muted-foreground' : 'bg-warning/15 text-warning',
      )}
    >
      {children}
    </span>
  );
}

/**
 * One tile of the grid: icon, label, a line of help. A built screen is a link; a planned one is a disabled "Soon" tile (not a
 * link, not focusable); a plan-gated one links on with an "Upgrade" mark, like the menu. `label` may carry search highlights.
 */
export function TileCard({
  tile,
  label,
  description,
  footer,
  resultRef,
}: {
  tile: ResolvedSettingsTile;
  label: ReactNode;
  description?: string;
  /** Extra line under the help, e.g. the section a search hit belongs to. */
  footer?: ReactNode;
  resultRef?: boolean;
}) {
  const t = useTranslations('settings');
  const body = (
    <>
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          tile.comingSoon ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        <SettingsIcon name={tile.icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words text-sm font-semibold">{label}</span>
          {tile.comingSoon ? (
            <Pill tone="soon">{t('soon')}</Pill>
          ) : tile.locked ? (
            <Pill tone="upgrade">{t('upgrade')}</Pill>
          ) : null}
        </span>
        {description && (
          <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        )}
        {footer && <span className="mt-1.5 block text-xs text-muted-foreground">{footer}</span>}
      </span>
    </>
  );
  const frame = 'flex items-start gap-3 rounded-xl border border-border bg-background p-4';
  if (tile.comingSoon) {
    return (
      <div
        aria-disabled="true"
        title={t('comingSoon')}
        data-settings-tile={tile.id}
        className={cn(frame, 'cursor-not-allowed opacity-70')}
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={tile.href}
      data-settings-tile={tile.id}
      data-settings-result={resultRef ? '' : undefined}
      className={cn(
        frame,
        'outline-none transition hover:border-primary/50 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {body}
    </Link>
  );
}
