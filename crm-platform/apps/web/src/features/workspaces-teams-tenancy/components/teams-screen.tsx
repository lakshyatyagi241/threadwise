'use client';

import { Alert, Button, EmptyState, Spinner } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WspTeam } from '@crm/contracts';
import { useMembersSummary, useTeams } from '../api/hooks';
import { PencilIcon, PlusIcon } from './icons';
import { WspProviders, useErrorText } from './parts';
import { TeamDialog, type TeamDevice } from './team-dialog';

/**
 * The devices a team can be limited to. The channels domain has no devices list yet (blocked: WD-WSP-022 device scoping),
 * so the picker stays hidden, exactly as WaDesk hides it for a workspace with a single device. Teams keep whatever
 * `deviceIds` they already have: the update only sends them when the picker is on screen.
 */
const NO_DEVICES: readonly TeamDevice[] = [];

/** `/teams`: the Team Inbox teams list with Create and Edit team (WD-WSP-022). */
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
  const summaryQ = useMembersSummary();
  const teamsQ = useTeams();
  const canManage = summaryQ.data?.me.canManageTeams ?? false;
  const [editing, setEditing] = useState<WspTeam | 'new' | null>(null);
  const loading = teamsQ.isPending;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage && (
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
        </ol>
      </details>

      {teamsQ.isError ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span>{errorText(teamsQ.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => void teamsQ.refetch()}>
            {tc('retry')}
          </Button>
        </Alert>
      ) : loading ? (
        <ul
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label={t('loading')}
        >
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-24 animate-pulse rounded-md border border-border bg-muted" />
          ))}
        </ul>
      ) : teamsQ.items.length === 0 ? (
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
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teamsQ.items.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                canEdit={canManage}
                onEdit={() => setEditing(team)}
              />
            ))}
          </ul>
          {teamsQ.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void teamsQ.fetchNextPage()}
                disabled={teamsQ.isFetchingNextPage}
              >
                {teamsQ.isFetchingNextPage && <Spinner />}
                {tc(teamsQ.isFetchingNextPage ? 'loadingMore' : 'loadMore')}
              </Button>
            </div>
          )}
        </>
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

function TeamCard({
  team,
  canEdit,
  onEdit,
}: {
  team: WspTeam;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.teams');
  const online = team.members.filter((m) => m.presence === 'online').length;
  return (
    <li
      data-testid={`team-card-${team.name}`}
      className="flex items-start gap-3 rounded-md border border-border bg-background p-4"
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ background: team.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{team.name}</h2>
          {team.isDefault && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
              {t('default')}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(`strategies.${team.assignmentStrategy}`)}
        </p>
        <p className="mt-2 text-xs">
          {t('members', { count: team.members.length })}
          {online > 0 && <span className="text-success"> · {t('online', { count: online })}</span>}
        </p>
        {team.deviceIds.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('devices', { count: team.deviceIds.length })}
          </p>
        )}
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
