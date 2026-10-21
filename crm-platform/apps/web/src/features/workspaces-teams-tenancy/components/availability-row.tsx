'use client';

import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useMyAvailability } from '../api/hooks';

/**
 * The Available / Offline switch of the signed-in agent, a row of the account menu. Offline takes the agent out of automatic
 * assignment (routing rules, round robin, least busy); chats they already hold stay theirs. It reads and writes
 * `agent_statuses` through the members API. When the read fails (a session that is not a workspace member) nothing is drawn.
 */
export function AvailabilityRow({ className }: { className?: string }) {
  const t = useTranslations('workspaces-teams-tenancy.availability');
  const { query, set } = useMyAvailability();
  if (!query.data) return null;
  const available = query.data.status === 'online';
  const label = available ? t('available') : t('offline');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={`${t('label')}: ${label}`}
      title={t('hint')}
      disabled={set.isPending}
      data-testid="user-menu-availability"
      className={cn(className, 'disabled:opacity-60')}
      onClick={() => set.mutate(available ? 'offline' : 'online')}
    >
      <span
        aria-hidden="true"
        className="flex size-4 items-center justify-center text-muted-foreground"
      >
        <span
          className={cn('size-2 rounded-full', available ? 'bg-success' : 'bg-muted-foreground/60')}
        />
      </span>
      <span className="flex-1">{t('label')}</span>
      <span
        className={cn(
          'font-mono text-[11px]',
          set.isError ? 'text-danger' : available ? 'text-success' : 'text-muted-foreground',
        )}
        role={set.isError ? 'alert' : undefined}
      >
        {set.isError ? t('failed') : label}
      </span>
    </button>
  );
}
