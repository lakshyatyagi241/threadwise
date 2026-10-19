'use client';

import { Alert, Button, EmptyState } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { WspTeam } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useAllTeams, useMembersSummary } from '../api/hooks';
import { treeOrder } from '../lib/team-tree';
import { PencilIcon, PlusIcon } from './icons';
import { WspProviders, useErrorText } from './parts';
import { TeamDialog, type TeamDevice } from './team-dialog';

/**
 * The devices a team can be limited to. The channels domain has no devices list yet (blocked: TW-WSP-022 device scoping),
 * so the picker stays hidden, exactly as Reference hides it for a workspace with a single device. Teams keep whatever
 * `deviceIds` they already have: the update only sends them when the picker is on screen.
 */
const NO_DEVICES: readonly TeamDevice[] = [];

/**
 * `/teams`: Settings > Team and permissions > Teams (TW-WSP-022, Teams v2). One list for chat, CRM and workspaces that have both:
 * teams are shown as a tree (a sub-team is indented under its parent), each with its manager, members, the two "can receive"
 * switches and where it is used.
 */
export function TeamsScreen() {
  return (
    <WspProviders>
      <Teams />
    </WspProviders>
  );
}

function Teams() {
  const t = useTranslations('workspaces-teams-tenancy.teams');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const errorText = useErrorText();
  const canRead = [useCan('team.read'), useCan('team.manage'), useCan('inbox.team.manage')].some(
    Boolean,
  );
  const summaryQ = useMembersSummary();
  const teamsQ = useAllTeams(canRead);
  const canManage = summaryQ.data?.me.canManageTeams ?? false;
  const [editing, setEditing] = useState<WspTeam | 'new' | null>(null);
  const rows = useMemo(() => treeOrder(teamsQ.items), [teamsQ.items]);
  const loading = teamsQ.isPending || teamsQ.hasNextPage;
  // The access summary fails fast (no retries) while the list retries a few times: whichever fails first is shown.
  const failed = summaryQ.isError ? summaryQ.error : teamsQ.isError ? teamsQ.error : null;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground" data-testid="teams-subtitle">
            {t('subtitle')}
          </p>
        </div>
        {canRead && canManage && (
          <Button className="shrink-0" onClick={() => setEditing('new')} data-testid="create-team">
            <PlusIcon /> {t('create')}
          </Button>
        )}
      </div>

      <details className="group rounded-md border border-border bg-muted/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11.5px] font-medium uppercase tracking-wider hover:bg-muted">
          {t('howTitle')}
        </summary>
        <ol className="list-decimal space-y-1.5 border-t border-border bg-background px-8 py-3 text-xs leading-relaxed">
          <li>{t('how.one')}</li>
          <li>{t('how.two')}</li>
          <li>{t('how.three')}</li>
          <li>{t('how.four')}</li>
        </ol>
      </details>

      {!canRead ? (
        <Alert tone="warning" data-testid="teams-no-access">
          {t('noAccess')}
        </Alert>
      ) : failed !== null ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span>{errorText(failed)}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void summaryQ.refetch();
              void teamsQ.refetch();
            }}
          >
            {tc('retry')}
          </Button>
        </Alert>
      ) : loading ? (
        <ul className="space-y-3" aria-busy="true" aria-label={t('loading')}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-20 animate-pulse rounded-md border border-border bg-muted" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyMessage')}
          actions={
            canManage ? (
              <Button onClick={() => setEditing('new')}>
                <PlusIcon /> {t('emptyAction')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="teams-tree">
          {rows.map(({ team, level }) => (
            <TeamRow
              key={team.id}
              team={team}
              level={level}
              canEdit={canManage}
              onEdit={() => setEditing(team)}
            />
          ))}
        </ul>
      )}

      <TeamDialog
        open={editing !== null}
        team={editing === 'new' ? null : editing}
        devices={NO_DEVICES}
        canDelete={canManage}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function usageLines(
  team: WspTeam,
  t: (key: string, values?: Record<string, string | number>) => string,
): string[] {
  const u = team.usage;
  const out: string[] = [];
  if (u.routingRules > 0) out.push(t('usage.routingRules', { count: u.routingRules }));
  if (u.assignmentRules > 0) out.push(t('usage.assignmentRules', { count: u.assignmentRules }));
  if (u.segmentShares > 0) out.push(t('usage.segmentShares', { count: u.segmentShares }));
  if (u.conversations > 0) out.push(t('usage.conversations', { count: u.conversations }));
  if (u.childTeams > 0) out.push(t('usage.childTeams', { count: u.childTeams }));
  return out;
}

function TeamRow({
  team,
  level,
  canEdit,
  onEdit,
}: {
  team: WspTeam;
  level: number;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.teams');
  const online = team.members.filter((m) => m.presence === 'online').length;
  const used = usageLines(team, t);
  const primaryCount = team.members.filter((m) => m.isPrimary).length;
  return (
    <li
      data-testid={`team-card-${team.name}`}
      data-level={level}
      style={{ marginInlineStart: `${Math.min(level, 4) * 1.5}rem` }}
      className="flex items-start gap-3 rounded-md border border-border bg-background p-4"
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ background: team.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{team.name}</h2>
          {team.isDefault && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
              {t('default')}
            </span>
          )}
          {team.receivesConversations && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">
              {t('receivesConversations')}
            </span>
          )}
          {team.receivesRecords && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">
              {t('receivesRecords')}
            </span>
          )}
        </div>
        {team.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{team.description}</p>
        )}
        <p className="mt-1 text-xs" data-testid={`team-manager-${team.name}`}>
          {team.lead ? t('manager', { name: team.lead.fullName }) : t('noManager')}
        </p>
        <p className="mt-1 text-xs">
          {t('members', { count: team.members.length })}
          {primaryCount > 0 && (
            <span className="text-muted-foreground"> · {t('primaryCount', { count: primaryCount })}</span>
          )}
          {online > 0 && <span className="text-success"> · {t('online', { count: online })}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" data-testid={`team-used-${team.name}`}>
          {used.length > 0 ? `${t('usedBy')}: ${used.join(' · ')}` : t('usedByNone')}
        </p>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          title={t('edit')}
          aria-label={`${t('edit')}: ${team.name}`}
          data-testid={`edit-team-${team.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PencilIcon />
        </button>
      )}
    </li>
  );
}
