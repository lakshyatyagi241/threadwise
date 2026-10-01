'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { ContactGroup, ContactStats } from '../api/schemas';
import { errorKind } from '../lib/errors';

const card = 'rounded-md border border-border bg-background p-2';
const kicker =
  'px-3 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

function RailButton({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  count?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition',
        active ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {count !== undefined && (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            active ? 'opacity-90' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString());

/** Left rail of the contacts screen (WD-CON-001, 003, 006): tip, views, groups, import format. */
export function ContactsRail({
  stats,
  groups,
  groupsPending,
  groupsError,
  activeGroup,
  imported,
  onGroup,
  onImported,
}: {
  stats: ContactStats | undefined;
  groups: readonly ContactGroup[] | undefined;
  groupsPending: boolean;
  groupsError: unknown;
  /** '' = all, 'no_group', or a group id. */
  activeGroup: string;
  imported: boolean;
  onGroup: (id: string) => void;
  onImported: (on: boolean) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.rail');
  const allView = activeGroup === '' && !imported;
  return (
    <aside className="space-y-3 self-start lg:sticky lg:top-6">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          {t('tipTitle')}
        </div>
        {t('tip')}
      </div>

      <div className={card}>
        <div className={kicker}>{t('views')}</div>
        <RailButton
          active={allView}
          onClick={() => {
            onImported(false);
            onGroup('');
          }}
          count={n(stats?.total)}
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          {t('allContacts')}
        </RailButton>
        <Link
          href="/contact-groups"
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
            {t('groups')}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {n(stats?.groups ?? groups?.length)}
          </span>
        </Link>
        <RailButton
          active={imported}
          onClick={() => onImported(!imported)}
          count={n(stats?.imported)}
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-sky-600" />
          {t('imported')}
        </RailButton>
        <RailButton
          active={activeGroup === 'no_group'}
          onClick={() => onGroup(activeGroup === 'no_group' ? '' : 'no_group')}
          count={n(stats?.noGroup)}
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-border" />
          {t('noGroup')}
        </RailButton>
      </div>

      <div className={card}>
        <div className={kicker}>{t('groupsTitle')}</div>
        <RailButton active={allView} onClick={() => onGroup('')} count={n(stats?.grouped)}>
          {t('allGroups')}
        </RailButton>
        {groupsPending && <p className="px-3 py-2 text-xs text-muted-foreground">{t('loading')}</p>}
        {Boolean(groupsError) && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {errorKind(groupsError) === 'unavailable' ? t('groupsUnavailable') : t('groupsFailed')}
          </p>
        )}
        {(groups ?? []).map((g) => (
          <RailButton
            key={g.id}
            active={activeGroup === g.id}
            onClick={() => onGroup(g.id)}
            count={g.memberCount.toLocaleString()}
          >
            <span
              aria-hidden="true"
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: g.color || 'var(--primary)' }}
            />
            <span className="truncate">{g.name}</span>
          </RailButton>
        ))}
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          {t('importTitle')}
        </div>
        {t('import')}
      </div>
    </aside>
  );
}
