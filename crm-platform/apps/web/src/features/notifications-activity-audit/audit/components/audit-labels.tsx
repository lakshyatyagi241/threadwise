'use client';

import { useTranslations } from 'next-intl';
import type { AuditActAs, AuditLogEntry } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { initials, isKnownAction, isKnownModule } from '../lib/format';

/** The words for an action (Created, Updated...) and a module; anything the app does not know yet is shown as the stored word. */
export function useAuditWords() {
  const t = useTranslations('audit-log');
  return {
    action: (a: string): string => (isKnownAction(a) ? t(`actions.${a}`) : a),
    module: (m: string): string => (isKnownModule(m) ? t(`modules.${m}`) : m),
  };
}

/** "System", "API key: name", "Platform support (acting as X)", or the person's name with their initials. */
export function ActorCell({
  entry,
  compact = false,
}: {
  entry: Pick<AuditLogEntry, 'actor' | 'actAs'>;
  compact?: boolean;
}) {
  const t = useTranslations('audit-log');
  const { actor, actAs } = entry;
  if (actAs) {
    const who = actor.name ?? t('actors.removedUser');
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar label="PS" tone="warning" />
        <div className="min-w-0">
          <div className="truncate font-medium">{t('actors.support')}</div>
          {!compact && (
            <div className="truncate text-xs text-muted-foreground">
              {t('actors.actingAs', { name: who })}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (actor.kind === 'user') {
    const name = actor.name ?? t('actors.removedUser');
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar label={initials(actor.name)} />
        <span dir="auto" className="truncate">
          {name}
        </span>
      </div>
    );
  }
  const label =
    actor.kind === 'api_key' && actor.name
      ? t('actors.apiKeyNamed', { name: actor.name })
      : t(`actors.${actor.kind}`);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar label={actor.kind === 'system' ? 'S' : actor.kind === 'api_key' ? 'K' : '#'} muted />
      <span dir="auto" className="truncate text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Avatar({
  label,
  tone,
  muted,
}: {
  label: string;
  tone?: 'warning';
  muted?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        tone === 'warning'
          ? 'bg-warning/15 text-warning'
          : muted
            ? 'bg-muted text-muted-foreground'
            : 'bg-brand/10 text-brand',
      )}
    >
      {label}
    </span>
  );
}

/** The marker on a row written while platform support was acting in the workspace. */
export function SupportBadge({ actAs }: { actAs: AuditActAs | null }) {
  const t = useTranslations('audit-log');
  if (!actAs) return null;
  return <Badge tone="warning">{t('actors.supportBadge')}</Badge>;
}
