'use client';

import { Badge, Button, EmptyState, Select, Spinner, cn } from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { WspMember, WspMembersSummary } from '@crm/contracts';
import { joinedDate } from '../lib/format';
import {
  PRESENCE_DOT,
  canChangeRole,
  canRemove,
  canReset,
  canResend,
  primaryRole,
  roleOptions,
} from '../lib/roles';
import { Avatar } from './parts';
import { LockIcon, MailIcon, TrashIcon } from './icons';

export interface RowActions {
  onRole: (member: WspMember, roleId: string) => void;
  onReset: (member: WspMember) => void;
  onResend: (member: WspMember) => void;
  onRemove: (member: WspMember) => void;
  /** The member a call is in flight for: its controls are disabled. */
  busyId: string | null;
}

function IconAction({
  label,
  tone,
  disabled,
  onClick,
  testId,
  children,
}: {
  label: string;
  tone: 'primary' | 'danger';
  disabled?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-full disabled:opacity-50 sm:size-8',
        tone === 'primary' ? 'text-primary hover:bg-primary/10' : 'text-danger hover:bg-danger/10',
      )}
    >
      {children}
    </button>
  );
}

function MemberRow({
  member,
  me,
  roles,
  actions,
}: {
  member: WspMember;
  me: WspMembersSummary['me'];
  roles: WspMembersSummary['roles'];
  actions: RowActions;
}) {
  const t = useTranslations('workspaces-teams-tenancy.members');
  const tt = useTranslations('workspaces-teams-tenancy.tiers');
  const locale = useLocale();
  const current = primaryRole(member);
  const joined = joinedDate(member.joinedAt, locale);
  const busy = actions.busyId === member.id;
  const isMe = member.id === me.id;
  const roleLabel = (tier: WspMember['tier'], name: string) =>
    tier === 'custom' ? name : tt(tier);

  return (
    <tr data-testid={`member-row-${member.email}`}>
      <td className="px-3 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Avatar name={member.fullName} />
          <div className="min-w-0 max-w-[6.5rem] sm:max-w-none">
            <div className="truncate text-[12.5px] font-semibold">
              {member.fullName}
              {isMe && (
                <span className="ms-1.5 text-[10.5px] font-normal text-muted-foreground">
                  ({t('you')})
                </span>
              )}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              {member.email}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        {canChangeRole(member, me) ? (
          <Select
            aria-label={t('roleFor', { name: member.fullName })}
            data-testid={`role-select-${member.email}`}
            className="h-8 w-auto min-w-24 max-w-28 px-2 text-xs sm:min-w-28 sm:max-w-none"
            value={current?.id ?? ''}
            disabled={busy}
            onChange={(e) => actions.onRole(member, e.target.value)}
          >
            {roleOptions(roles, current).map((r) => (
              <option key={r.id} value={r.id} disabled={r.disabled}>
                {roleLabel(r.tier, r.name)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge className="font-mono text-[10.5px] uppercase tracking-wide">
            {roleLabel(member.tier, current?.name ?? member.tier)}
          </Badge>
        )}
      </td>
      <td className="hidden px-3 py-3 sm:table-cell">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              member.status === 'inactive' ? PRESENCE_DOT.offline : PRESENCE_DOT[member.presence],
            )}
          />
          <span className="text-[11.5px]">
            {member.status === 'inactive' ? t('inactive') : t(`presence.${member.presence}`)}
          </span>
        </span>
      </td>
      <td className="hidden px-3 py-3 text-[11.5px] md:table-cell">
        {joined ??
          (member.status === 'pending' ? (
            <span className="italic text-muted-foreground">{t('pending')}</span>
          ) : (
            <span className="text-muted-foreground">–</span>
          ))}
      </td>
      <td className="py-3 pe-2 ps-1 text-end sm:pe-5 sm:ps-3">
        <div className="inline-flex items-center gap-1">
          {canResend(member, me) && (
            <IconAction
              label={t('resendAction')}
              tone="primary"
              disabled={busy}
              testId={`resend-${member.email}`}
              onClick={() => actions.onResend(member)}
            >
              <MailIcon />
            </IconAction>
          )}
          {canReset(member, me) && (
            <IconAction
              label={t('resetAction')}
              tone="primary"
              disabled={busy}
              testId={`reset-${member.email}`}
              onClick={() => actions.onReset(member)}
            >
              <LockIcon />
            </IconAction>
          )}
          {canRemove(member, me) && (
            <IconAction
              label={t('removeAction')}
              tone="danger"
              disabled={busy}
              testId={`remove-${member.email}`}
              onClick={() => actions.onRemove(member)}
            >
              <TrashIcon />
            </IconAction>
          )}
        </div>
      </td>
    </tr>
  );
}

/** The skeleton rows WaDesk shows while the list loads. */
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </td>
          {[16, 12, 20, 8].map((w, j) => (
            <td
              key={j}
              className={cn(
                'px-3 py-3',
                j === 1 && 'hidden sm:table-cell',
                j === 2 && 'hidden md:table-cell',
              )}
            >
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w * 4}px` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function MembersTable({
  members,
  summary,
  loading,
  refreshing = false,
  filtered,
  canInvite,
  actions,
  onInvite,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  members: WspMember[];
  summary: WspMembersSummary | undefined;
  loading: boolean;
  /** A new search or filter is being answered: the previous rows stay on screen, dimmed. */
  refreshing?: boolean;
  /** A search or a role filter is active: the empty state says "no match" instead of "none yet". */
  filtered: boolean;
  canInvite: boolean;
  actions: RowActions;
  onInvite: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy');
  const empty = !loading && !refreshing && members.length === 0;

  return (
    <div>
      <div className="overflow-x-auto">
        <table
          className={cn('w-full text-[12.5px]', refreshing && 'opacity-60')}
          aria-label={t('members.table')}
          aria-busy={loading || refreshing}
        >
          <thead className="border-b border-border bg-muted/60 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-start font-medium sm:px-5">
                {t('members.columns.name')}
              </th>
              <th scope="col" className="w-[180px] px-3 py-2.5 text-start font-medium">
                {t('members.columns.role')}
              </th>
              <th
                scope="col"
                className="hidden w-[120px] px-3 py-2.5 text-start font-medium sm:table-cell"
              >
                {t('members.columns.status')}
              </th>
              <th
                scope="col"
                className="hidden w-[140px] px-3 py-2.5 text-start font-medium md:table-cell"
              >
                {t('members.columns.joined')}
              </th>
              <th
                scope="col"
                className="w-[110px] py-2.5 pe-2 ps-1 text-end font-medium sm:pe-5 sm:ps-3"
              >
                <span className="sr-only">{t('members.columns.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <SkeletonRows />}
            {!loading &&
              summary &&
              members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  me={summary.me}
                  roles={summary.roles}
                  actions={actions}
                />
              ))}
          </tbody>
        </table>
      </div>
      {empty && (
        <div className="p-4">
          <EmptyState
            title={t('members.emptyTitle')}
            message={filtered ? t('members.emptyFiltered') : t('members.emptyNone')}
            actions={
              canInvite ? <Button onClick={onInvite}>{t('members.emptyInvite')}</Button> : undefined
            }
          />
        </div>
      )}
      {hasMore && (
        <div className="flex justify-center border-t border-border p-3">
          <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore && <Spinner />}
            {loadingMore ? t('common.loadingMore') : t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
